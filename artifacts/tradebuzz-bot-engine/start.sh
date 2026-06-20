#!/bin/bash
# TradeBuzz Bot Engine — production start script
set -e
cd "$(dirname "$0")"
pip install -r requirements.txt -q
exec python run.py
