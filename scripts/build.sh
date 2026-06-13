#!/bin/bash

# Build server
yarn clear
yarn core build
yarn game build
yarn server build
node scripts/fix-tsc-paths

# Build client
yarn client build