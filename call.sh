#!/bin/zsh
set -euo pipefail

PRIVATE_KEY=$(jq -r '.private_keys[0]' ~/.zetachain/localnet/anvil.json)

RECEIVER=0x40918Ba7f132E0aCba2CE4de4c4baF9BD2D7D849
PAYLOAD_STR=alice

RECEIVER_HEX=$(echo "$RECEIVER" | sed 's/^0x//' | tr '[:upper:]' '[:lower:]')
if [ ${#RECEIVER_HEX} -ne 40 ]; then
  echo "Receiver address must be 20 bytes (40 hex chars), got ${#RECEIVER_HEX}"
  exit 1
fi

PAYLOAD_HEX=$(printf '%s' "$PAYLOAD_STR" | xxd -p -c 256 | tr -d '\n')
MEMO_HEX="${RECEIVER_HEX}${PAYLOAD_HEX}"

TSS=$(jq -r '.["18332"].contracts[] | select(.contractType == "gateway") | .address' ~/.zetachain/localnet/registry.json)
AMOUNT=0.001

bitcoin-cli -regtest listwallets | grep -q '"user"' || bitcoin-cli -regtest loadwallet user >/dev/null 2>&1 || bitcoin-cli -regtest createwallet user >/dev/null

ADDR=$(bitcoin-cli -regtest -rpcwallet=user getnewaddress)

bitcoin-cli -regtest generatetoaddress 101 "$ADDR" >/dev/null

bitcoin-cli -regtest -rpcwallet=user settxfee 0.0001

RAW=$(bitcoin-cli -regtest -rpcwallet=user -named createrawtransaction inputs='[]' outputs='[{"'"$TSS"'":'"$AMOUNT"'},{"data":"'"$MEMO_HEX"'"}]')

FUNDED=$(bitcoin-cli -regtest -rpcwallet=user fundrawtransaction "$RAW" | jq -r .hex)

SIGNED=$(bitcoin-cli -regtest -rpcwallet=user signrawtransactionwithwallet "$FUNDED" | jq -r .hex)

TXID=$(bitcoin-cli -regtest sendrawtransaction "$SIGNED")
echo "$TXID"