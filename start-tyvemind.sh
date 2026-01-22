#!/bin/bash
cd /app
export PORT=3000
export $(cat .env | grep -v '^#' | xargs)
exec yarn dev
