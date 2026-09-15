#!/bin/bash
set -e
swiftc -O bin/ocr-vision.swift -o bin/ocr-vision
chmod +x bin/ocr-vision
