#!/bin/bash
cd /app
export $(cat .env | grep -v '^#' | xargs)
exec yarn dev
