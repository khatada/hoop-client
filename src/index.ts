"use strict"

import * as path from "path";
import * as http from "http";
import WebSocket = require("ws");
const HttpsProxyAgent = require("https-proxy-agent");
import * as request from "request";

const channel = "test";
const base = "http://localhost:3000/";

export type Method = "GET" | "POST" | "PUT" | "DELETE";

export interface RestData {
    method: Method;
    path: string;
    headers: object;
    body?: object;
    status?: number;
}

export interface TunnelMessage {
    command: string;
    session: string;
    data?: RestData;
    channel: string;
    error?: any;
}

function uniqueId(n: number = 8): string {
    const letters = "abcdefghijklmnopqrstuvwxyz";
    let id = "";
    for (let i = 0; i < n; i++) {
        const char = letters[Math.floor(Math.random() * letters.length)];
        id += char;
    }
    return id;
}

function ignoreHeader(header: string): boolean {
    const lower = header.toLowerCase();
    const ignore = ["connection", "host", "content-length"];
    return ignore.indexOf(lower) >= 0;
}


export class TunnelClient {
    readonly host: string;
    readonly channel: string;
    readonly proxy: string;
    readonly heartBeatInterval: number;
    readonly target: string;

    private ws: WebSocket;
    private needsReconnect: boolean = true;
    private reconnectTimer: any = null;
    private heartBeatTimer: any = null;
    private queue: Buffer[] = [];
    private isSending: boolean = false;

    private request: {[id: string]: request.Request} = {};

    static readonly MESSAGE_ID_HEADER = 8;
    static readonly MESSAGE_COMMAND_HEADER = 1;

    constructor(options: { channel: string, host: string, proxy: string, target: string, heartBeatInterval?: number }) {
        this.host = options.host;
        this.target = options.target;
        this.proxy = options.proxy;
        this.channel = options.channel;
        if (options.heartBeatInterval && options.heartBeatInterval > 0) {
            this.heartBeatInterval = options.heartBeatInterval;
        } else {
            this.heartBeatInterval = 5000;
        }

        this.onOpen = this.onOpen.bind(this);
        this.onClose = this.onClose.bind(this);
        this.onMessage = this.onMessage.bind(this);
        this.onError = this.onError.bind(this);
        this.connect();
    }

    dispose() {
        this.needsReconnect = false;
        this.ws.close();
    }

    private connect() {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;

        let agent: http.Agent = null;
        if (this.proxy) {
            agent = new HttpsProxyAgent(this.proxy);
        }
        const serverUrl = this.host + "/hoop/" + this.channel;
        console.log(new Date(), `Connect to server. url=${serverUrl}`);
        this.ws = new WebSocket(serverUrl, { agent: agent });
        this.ws.on("open", this.onOpen);
        this.ws.on("close", this.onClose);
        this.ws.on("message", this.onMessage);
        this.ws.on("error", this.onError);
    }

    private onOpen() {
        console.log(new Date(), "Websocket connection open.");
        this.repeatSendHeartBeat();
    }

    private onClose(code: string, reason: string): void {
        clearTimeout(this.heartBeatTimer);

        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws = null;
        }

        if (this.needsReconnect && !this.reconnectTimer) {
            this.reconnectTimer = setTimeout(this.connect.bind(this), 3000);
        }
    }

    private onError(error) {
        console.error(new Date(), error);
    }

    private onMessage(data: Buffer): void {
        try {
            console.log(data);
            const idBuffer = data.slice(0, TunnelClient.MESSAGE_ID_HEADER);
            const commandBuffer = data.slice(TunnelClient.MESSAGE_ID_HEADER, TunnelClient.MESSAGE_ID_HEADER + TunnelClient.MESSAGE_COMMAND_HEADER);
            const id = idBuffer.toString("utf-8", 0, TunnelClient.MESSAGE_ID_HEADER);
            const command = commandBuffer.toString();
            console.log(`Tunnel message. id=${id} command=${command}`);
            if (command === "h") {
                const headerBuffer = data.slice(TunnelClient.MESSAGE_ID_HEADER + TunnelClient.MESSAGE_COMMAND_HEADER);
                const header = JSON.parse(headerBuffer.toString());
                console.log(header);
                const headers = {};
                Object.keys(header.headers).forEach(name => {
                    if(!ignoreHeader(name)){
                        headers[name] = header.headers[name];
                    }
                });
                const options: request.CoreOptions = {
                    method: header.method,
                    headers,
                    proxy: null, timeout: 30000
                };
                const targetURL = this.target + header.path + (header.query ? `?${header.query}` : "");
                console.log(targetURL);
                this.request[id] = request(targetURL, options);
                this.request[id].on("response", (res) => {
                    const commandBuffer = new Buffer("h");
                    const header = JSON.stringify({headers: res.headers, status: res.statusCode});
                    const message = Buffer.concat([idBuffer, commandBuffer, new Buffer(header)]);
                    this.queueSend(message);
                });
                this.request[id].on("data", (data: Buffer) => {
                    const commandBuffer = new Buffer("s");
                    const message = Buffer.concat([idBuffer, commandBuffer, data]);
                    this.queueSend(message);
                });
                this.request[id].on("end", () => {
                    const commandBuffer = new Buffer("e");
                    const message = Buffer.concat([idBuffer, commandBuffer]);
                    this.queueSend(message);
                    delete this.request[id];
                });
                this.request[id].on("error", () => {
                    const commandBuffer = new Buffer("a");
                    const message = Buffer.concat([idBuffer, commandBuffer]);
                    this.queueSend(message);
                    delete this.request[id];
                });
            } else if (command === "s") {
                const dataBuffer = data.slice(TunnelClient.MESSAGE_ID_HEADER + TunnelClient.MESSAGE_COMMAND_HEADER);
                if(this.request[id]) {
                    this.request[id].write(dataBuffer);
                }
            } else if (command === "e") {
                if(this.request[id]) {
                    this.request[id].end();
                }
            } else if (command === "a") {
                if(this.request[id]) {
                    this.request[id].abort();
                    this.request[id] = null;
                }
            }
        } catch (error) {
            console.warn(error);
        }
    }

    private sendHeartBeat(): void {
        console.log(new Date(), `Send heart beat. channel=${channel}`);
        if (this.ws) {
            const id = uniqueId(TunnelClient.MESSAGE_ID_HEADER);
            this.queueSend(new Buffer(id));
        }
    }


    private repeatSendHeartBeat(): void {
        clearTimeout(this.heartBeatTimer);
        this.sendHeartBeat();
        this.heartBeatTimer = setTimeout(this.repeatSendHeartBeat.bind(this), this.heartBeatInterval);
    }

    private queueSend(buffer: Buffer): void {
        this.queue.push(buffer);
        this.sendToServer();
    }

    private sendToServer(): void {
        if (this.ws) {
            if (this.isSending) {
                // do nothing
            } else if (this.queue.length) {
                this.isSending = true;
                const head = this.queue.shift();
                this.ws.send(head, (error) => {
                    this.isSending = false;
                    if (error) {
                        this.queue = [];
                        console.error(error);
                    } else {
                        this.sendToServer();
                    }
                });
            }
        } else {
            this.isSending = false;
            this.queue = [];
        }
    }
}

function getProxyFromEnvironment(): string {
    return process.env.https_proxy || process.env.HTTPS_PROXY;
}
const proxy = getProxyFromEnvironment();
const tunnel = new TunnelClient({channel: "test", host: "ws://localhost:8080", proxy: null, target: "http://localhost:4567"});