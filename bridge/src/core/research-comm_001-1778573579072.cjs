// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:12:59.073Z

// This script demonstrates various ways to detect sister status beyond HTTP ping.
// It includes TCP socket communication, UDP broadcast, and a simple file-based status check.
//
// Note: This is a conceptual example and may require adjustments for real-world use.
//
// Author: AI Assistant
// Date: 
// ---------------------------------------------------------------

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path, path');

// -------------------------------------------------------------------
// 1. TCP Socket Communication (detects sister status via direct TCP connection)
// -------------------------------------------------------------------

// TCP Server (listens for sister node)
const tcpServer = net.createServer((socket) => {
    console.log('TCP Server: Connection established with sister node.');

    // Send a greeting
    socket.write('HELLO_SISTER\n');

    // Listen for response
    socket.on('data', (data)