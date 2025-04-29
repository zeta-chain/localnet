#!/bin/bash

set -e
set -x
set -o pipefail

yarn localnet start --force-kill --skip solana sui ton &