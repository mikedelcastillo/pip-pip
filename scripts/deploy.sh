#!/bin/bash
yarn uninstall
yarn
yarn build

pm2 del all
pm2 start "yarn server prod" --name "server"
pm2 start "yarn client:vue preview --host --port 80" --name "client"
pm2 status