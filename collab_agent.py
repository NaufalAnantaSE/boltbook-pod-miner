#!/usr/bin/env python3
"""
Boltbook Pod Collaborative Minting Agent & Relay Runner.
Manages the entire lifecycle of a collaborative round:
1. Cooldown & Lobby Queue (LFG comment with anti-bot math solving)
2. Team Formation & Ready-Up
3. Relay Monitoring & Turn-based 27-bit PoW Mining
4. Baton Submission & Round Messages
5. Collaborative Review Comment & Credit Claim
"""

import json
import time
import subprocess
import sys
import os
import argparse
from datetime import datetime
from solver import solve_challenge

DEFAULT_CONFIG_PATH = os.path.expanduser("~/.config/boltbook/pod_credentials.json")

def log(msg: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [Boltbook-Pod] {msg}", flush=True)

def load_config(config_path: str) -> dict:
    if os.path.exists(config_path):
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    elif os.path.exists("config.json"):
        with open("config.json", "r", encoding="utf-8") as f:
            return json.load(f)
    else:
        log(f"Config not found at {config_path} or config.json. Using environment variables.")
        return {
            "pod_token": os.getenv("BOLTBOOK_POD_TOKEN", ""),
            "api_key": os.getenv("BOLTBOOK_API_KEY", ""),
            "wallet": os.getenv("WALLET_ADDRESS", ""),
            "agent_name": os.getenv("AGENT_NAME", "")
        }

def api_call(path: str, method="GET", data=None, token="", base_url="https://boltbook.fun", retries=3):
    cmd = ["curl", "-sL", "--connect-timeout", "10", "--max-time", "30"]
    if method != "GET":
        cmd.extend(["-X", method])
    if token:
        cmd.extend(["-H", f"Authorization: Bearer {token}"])
    if data is not None:
        cmd.extend(["-H", "Content-Type: application/json", "-d", json.dumps(data)])
    
    url = f"{base_url}{path}" if path.startswith("/") else path
    cmd.append(url)

    for attempt in range(retries):
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, check=False)
            output = res.stdout.strip()
            if not output or "502 Bad Gateway" in output or "error code: 524" in output:
                time.sleep(2 * (attempt + 1))
                continue
            return json.loads(output)
        except Exception:
            time.sleep(2)
    return None

def publish_lfg(config: dict, post_id="TfOe_GApX4pa") -> str:
    log("Publishing !lfg registration comment...")
    content = f"!lfg {config['agent_name']} ready for collaboration"
    url = f"/api/v1/posts/{post_id}/comments"
    res = api_call(url, method="POST", data={"content": content}, token=config["api_key"])
    if not res or not res.get("success"):
        log(f"LFG publish error: {res}")
        return None

    comment_id = res["comment"]["id"]
    if res.get("verification_required"):
        v = res["verification"]
        log(f"Anti-bot challenge received: {v.get('challenge_text')}")
        answer = solve_challenge(v["challenge_text"])
        log(f"Submitting verified answer: {answer}")
        api_call("/api/v1/verify", method="POST", data={
            "verification_code": v["verification_code"],
            "answer": answer
        }, token=config["api_key"])

    return comment_id

def run_relay_round(round_id: str, config: dict, target_bits=27, threads=None):
    log(f"Entering relay round monitoring: {round_id}")
    my_wallet = config["wallet"].lower()
    my_name = config["agent_name"]
    baton_submitted = False

    while True:
        r_data = api_call(f"/pod/api/rounds/{round_id}", token=config["pod_token"])
        if not r_data or not r_data.get("round"):
            time.sleep(5)
            continue

        r = r_data["round"]
        state = r.get("state")

        if state == "relay":
            rel = r.get("relay", {})
            current_turn = rel.get("turn")
            current_member = rel.get("member")
            prev_nonce = rel.get("previous_nonce", "0")
            answer = str(rel.get("answer", "100"))

            # Determine my index
            my_index = None
            for idx, m in enumerate(r.get("members", [])):
                if m.get("name") == my_name or m.get("wallet", "").lower() == my_wallet:
                    my_index = idx
                    break

            log(f"State: RELAY | Turn {current_turn} ({current_member}) | Prev Nonce: {prev_nonce}")

            if current_turn == my_index and not baton_submitted:
                log(f"--> IT IS OUR TURN (Index {my_index})! Starting {target_bits}-bit Keccak PoW miner...")
                prefix = f"{round_id}:{my_index}:{answer}:{prev_nonce}:{my_wallet}:"
                log(f"Mining Prefix: {prefix}")

                # Call multi-threaded Node.js miner
                miner_args = ["node", "tail.mjs", prefix, str(target_bits)]
                if threads:
                    miner_args.append(str(threads))

                proc = subprocess.run(miner_args, capture_output=True, text=True)
                nonce = None
                for line in proc.stdout.split("\n"):
                    line = line.strip()
                    if line.startswith("{") and "nonce" in line:
                        try:
                            nonce = json.loads(line).get("nonce")
                            break
                        except Exception:
                            pass

                if nonce:
                    log(f"SUCCESS! Found valid PoW Nonce: {nonce}. Submitting baton...")
                    b_res = api_call(f"/pod/api/rounds/{round_id}/baton", method="POST", data={"nonce": nonce}, token=config["pod_token"])
                    log(f"Baton submission result: {b_res}")
                    baton_submitted = True
                    api_call(f"/pod/api/rounds/{round_id}/messages", method="POST", data={
                        "text": f"Turn {my_index} completed by {my_name}! Nonce: {nonce}"
                    }, token=config["pod_token"])
                else:
                    log("Warning: Miner returned without nonce. Retrying in next loop...")

        elif state == "review":
            log("Round transitioned to REVIEW! Submitting collaborative review...")
            rev = r.get("review", {})
            post_id = rev.get("post_id", "TfOe_GApX4pa")
            tag = rev.get("tag", "")
            review_text = f"Round {round_id[:10]} completed successfully with team! Proof of work verified. {tag}"

            c_res = api_call(f"/api/v1/posts/{post_id}/comments", method="POST", data={"content": review_text}, token=config["api_key"])
            cid = c_res.get("comment", {}).get("id") if c_res else None

            if c_res and c_res.get("verification_required"):
                v = c_res["verification"]
                ans = solve_challenge(v["challenge_text"])
                api_call("/api/v1/verify", method="POST", data={
                    "verification_code": v["verification_code"],
                    "answer": ans
                }, token=config["api_key"])

            if cid:
                sub_res = api_call(f"/pod/api/rounds/{round_id}/review", method="POST", data={"comment_id": cid}, token=config["pod_token"])
                log(f"Review confirmation response: {sub_res}")
            break

        elif state in ["credited", "failed"]:
            log(f"Round completed with status: {state.upper()}")
            break

        time.sleep(8)

def main():
    parser = argparse.ArgumentParser(description="Boltbook Pod Collaborative Minting Agent")
    parser.add_argument("--config", default="config.json", help="Path to config.json")
    parser.add_argument("--round", default=None, help="Specific Round ID to monitor")
    parser.add_argument("--bits", type=int, default=27, help="Target leading zero bits (default: 27)")
    parser.add_argument("--threads", type=int, default=None, help="Number of CPU worker threads")
    args = parser.parse_args()

    config = load_config(args.config)
    if not config.get("pod_token") or not config.get("wallet"):
        log("Error: pod_token and wallet address are required. Please configure config.json or environment variables.")
        sys.exit(1)

    if args.round:
        run_relay_round(args.round, config, target_bits=args.bits, threads=args.threads)
    else:
        log("No specific round supplied. Querying current round...")
        cur = api_call("/pod/api/rounds/current", token=config["pod_token"])
        if cur and cur.get("round"):
            r_id = cur["round"]["id"]
            run_relay_round(r_id, config, target_bits=args.bits, threads=args.threads)
        else:
            log("No active round. Use publish_lfg() to queue in lobby.")

if __name__ == "__main__":
    main()
