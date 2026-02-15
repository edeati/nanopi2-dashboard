#!/bin/bash
export NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"
lsof -tiTCP:8090 -sTCP:LISTEN | xargs -r kill; nohup npm start &