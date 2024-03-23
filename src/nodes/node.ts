import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { delay } from "../utils";
import { Value, NodeState } from "../types";

export async function node(
  nodeId: number, // // the ID of the node
  N: number,  // total number of nodes in the network
  F: number,  // number of faulty nodes in the network
  initialValue: Value,  // initial value of the node
  isFaulty: boolean,  // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  // this route allows retrieving the current status of the node
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  // Initialize node state
  let currentNodeState: NodeState = { killed: false, x: null, decided: null, k: null };
  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();

  // this route allows the node to receive messages from other nodes
  node.post("/message", (req, res) => {
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

  // this route is used to start the consensus algorithm
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

  // this route is used to stop the consensus algorithm
  node.get("/stop", async (req, res) => {
    currentNodeState.killed = true;
    res.status(200).send("killed");
  });

  // get the current state of a node
  node.get("/getState", (req, res) => {
    res.status(200).send({
      killed: currentNodeState.killed,
      x: currentNodeState.x,
      decided: currentNodeState.decided,
      k: currentNodeState.k,
    });
  });

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}