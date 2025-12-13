#!/bin/bash
# Development script for Gas Station Security System

echo "Starting Gas Station Security System..."

# Run Express server and Vite dev server concurrently
npx concurrently \
  "tsx watch server/index.ts --clear-screen=false" \
  "vite --config vite.config.ts --host 0.0.0.0 --port 5000"
