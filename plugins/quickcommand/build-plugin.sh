#!/bin/sh
npm i -g @quasar/cli
cd plugin && npm i && cd .. && npm i
quasar build
