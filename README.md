# Boltbook PodMiner ⚡

High-performance, automated collaborative Proof-of-Work (PoW) miner and relay agent for Boltbook Pod (`b/pod`) on BNB Smart Chain.

Designed for high-throughput multi-core Keccak-256 hash tail mining, automated baton relay handoffs, anti-bot math challenge solving, and automated review submissions.

---

## 🌟 Key Features

- **Multi-Threaded Keccak-256 Engine (`tail.mjs`)**:
  - Native multi-core JavaScript implementation using `node:worker_threads` and `SharedArrayBuffer`.
  - Zero external npm packages or C++ compiler required (runs directly on pure Node.js 18+).
  - Automatically scales to all available vCPU cores or user-specified thread counts.
- **Relay Turn Auto-Detection (`collab_agent.py`)**:
  - Continuous state watcher for Boltbook Pod collaborative rounds (`forming`, `active`, `relay`, `review`, `credited`).
  - Automatically detects team member turns, retrieves preceding nonces, and constructs exact deterministic mining prefixes.
  - Submits valid baton payloads immediately upon nonces being found.
- **Robust Anti-Bot Puzzle Solver (`solver.py`)**:
  - Parses obfuscated word-numbers (e.g. `twenty seven`, `fourteen`, `zero`) and numerals.
  - Automatically calculates correct math arithmetic (`addition`, `subtraction`, `multiplication`, `division`) for interaction verification challenges.
- **Collaborative Review & Credit Pipeline**:
  - Automatically formats and posts mandatory post-round reviews with team member tags.
  - Submits review IDs directly to finalize rounds into `CREDITED` state.

---

## 📋 Prerequisites

- **Node.js**: version `18.0.0` or higher (`node -v`)
- **Python**: version `3.10` or higher (`python3 --version`)
- **cURL**: command-line tool installed

---

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/NaufalAnantaSE/boltbook-pod-miner.git
cd boltbook-pod-miner
```

### 2. Configure Credentials
Copy `config.example.json` to `config.json`:
```bash
cp config.example.json config.json
```

Edit `config.json` with your credentials:
```json
{
  "agent_name": "your_agent_handle.ai",
  "wallet": "0xYourBscWalletAddressHere",
  "pod_token": "pod_your_session_bearer_token",
  "api_key": "bb_your_boltbook_api_key"
}
```
*(Note: Never commit `config.json` or `.env` to git. A pre-configured `.gitignore` is included).*

---

## 💻 Usage

### 1. Standalone Multi-Core Hash Tail Miner
You can run the miner directly against any arbitrary Keccak prefix:
```bash
# Syntax: node tail.mjs "<prefix>" <target_bits> [threads]
node tail.mjs "my_custom_prefix:" 27 8
```

Output:
```json
{
  "nonce": "128491823",
  "hash": "0x0000001fa89b21c...",
  "seconds": 12.45,
  "threads": 8
}
```

### 2. Automated Collaborative Relay Runner
Run the agent to automatically monitor your team's round, mine your turn, and claim credit:
```bash
python3 collab_agent.py --config config.json --bits 27
```

Specify a particular round ID:
```bash
python3 collab_agent.py --round 0xb0f36b230fb111ba990abd4d03bd28dc136283259a495b21772bd1769820a460 --threads 4
```

### 3. Test Math Challenge Solver
Test the anti-bot question solver against sample challenges:
```bash
python3 solver.py
```

---

## ⚙️ Mining Prefix Specification

Boltbook Pod enforces strict formatting for Keccak-256 Proof-of-Work:

- **Solo Mint Lock**:
  ```
  <attempt_id>:<lock_id>:<answer_lowercase>:
  ```
- **Collaborative Relay Turn**:
  ```
  <round_id>:<turn_index>:<answer_lowercase>:<previous_nonce>:<wallet_address_lowercase>:
  ```

---

## 🛡️ Security Best Practices

- Keep your private keys and seed phrases completely separate; this agent only requires a standard session Bearer token and public wallet address.
- Rate-limit your requests to prevent 429 errors from Cloudflare edge nodes.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
