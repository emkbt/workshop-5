import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";
import { delay } from "../utils";

/**
 * Starts a node in the network for the consensus algorithm.
 * @param {number} nodeId - The ID of the node.
 * @param {number} N - Total number of nodes in the network.
 * @param {number} F - Number of faulty nodes in the network.
 * @param {Value} initialValue - Initial value of the node.
 * @param {boolean} isFaulty - True if the node is faulty, false otherwise.
 * @param {Function} nodesAreReady - Function to check if all nodes are ready to receive requests.
 * @param {Function} setNodeIsReady - Function to call when the node is started and ready to receive requests.
 * @returns {Express.Application} The Express application instance for the node.
 */
export async function node(
  nodeId: number,
  N: number,
  F: number,
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  // Initialize node state
  let currentNodeState: NodeState = { killed: false, x: null, decided: null, k: null };
  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();

  // Route to retrieve the current status of the node
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  // Route to receive messages from other nodes
  node.post("/message", async (req, res) => {
    let { k, x, messageType } = req.body;
    if (!isFaulty && !currentNodeState.killed) {
      if (messageType == "propose") {
        // Handling propose messages
        if (!proposals.has(k)) {
          proposals.set(k, []);
        }
        proposals.get(k)!.push(x);
        let proposal = proposals.get(k)!;
        if (proposal.length >= (N - F)) {
          // Consensus reached on proposal, start voting
          let count0 = proposal.filter((el) => el == 0).length;
          let count1 = proposal.filter((el) => el == 1).length;
          if (count0 > (N / 2)) {
            x = 0;
          } else if (count1 > (N / 2)) {
            x = 1;
          } else {
            x = "?";
          }
          for (let i = 0; i < N; i++) {
            fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ k: k, x: x, messageType: "vote" }),
            });
          }
        }
      } else if (messageType == "vote") {
        // Handling vote messages
        if (!votes.has(k)) {
          votes.set(k, []);
        }
        votes.get(k)!.push(x);
        let vote = votes.get(k)!;
        if (vote.length >= (N - F)) {
          // Consensus reached on vote
          let count0 = vote.filter((el) => el == 0).length;
          let count1 = vote.filter((el) => el == 1).length;
          if (count0 >= F + 1) {
            currentNodeState.x = 0;
            currentNodeState.decided = true;
          } else if (count1 >= F + 1) {
            currentNodeState.x = 1;
            currentNodeState.decided = true;
          } else {
            if (count0 + count1 > 0 && count0 > count1) {
              currentNodeState.x = 0;
            } else if (count0 + count1 > 0 && count0 < count1) {
              currentNodeState.x = 1;
            } else {
              currentNodeState.x = Math.random() > 0.5 ? 0 : 1;
            }
            currentNodeState.k = k + 1;
            for (let i = 0; i < N; i++) {
              fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ k: currentNodeState.k, x: currentNodeState.x, messageType: "propose" }),
              });
            }
          }
        }
      }
    }
    res.status(200).send("Message received and processed.");
  });

  // Route to start the consensus algorithm
  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) {
      await delay(5);
    }
    if (!isFaulty) {
      // Start consensus algorithm
      currentNodeState.k = 1;
      currentNodeState.x = initialValue;
      currentNodeState.decided = false;
      for (let i = 0; i < N; i++) {
        fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ k: currentNodeState.k, x: currentNodeState.x, messageType: "propose" }),
        });
      }
    } else {
      // Node is faulty
      currentNodeState.decided = null;
      currentNodeState.x = null;
      currentNodeState.k = null;
    }
    res.status(200).send("Consensus algorithm started.");
  });

  // Route to stop the consensus algorithm
  node.get("/stop", async (req, res) => {
    currentNodeState.killed = true;
    res.status(200).send("killed");
  });

  // Route to retrieve the current state of the node
  node.get("/getState", (req, res) => {
    res.status(200).send({
      killed: currentNodeState.killed,
      x: currentNodeState.x,
      decided: currentNodeState.decided,
      k: currentNodeState.k,
    });
  });

  // Start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    // The node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}