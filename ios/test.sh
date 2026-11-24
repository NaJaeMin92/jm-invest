#!/bin/sh
set -eu
cd "$(dirname "$0")"
output=$(mktemp -d)
trap 'rm -rf "$output"' EXIT
xcrun swiftc -parse-as-library JMInvest/Trading.swift JMInvest/AccountStore.swift JMInvest/Kiwoom.swift Tests/BrokerChecks.swift -o "$output/checks"
"$output/checks"
