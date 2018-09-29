"use strict"

import * as url from "url";
import * as http from "http";
import WebSocket = require("ws");
import * as querystring from "querystring";
const HttpsProxyAgent = require("https-proxy-agent");
import * as commander from "commander";
const packageJson = require("../package.json");

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
    const ignore = ["connection", "host"];
    return ignore.indexOf(lower) >= 0;
}


export class TunnelClient {
    readonly host: string;
    readonly channel: string;
    readonly proxy: string;
    readonly heartBeatInterval: number;
    readonly target: string;
    readonly authToken: string;

    private ws: WebSocket;
    private needsReconnect: boolean = true;
    private reconnectTimer: any = null;
    private heartBeatTimer: any = null;
    private queue: Buffer[] = [];
    private isSending: boolean = false;

    private request: {[id: string]: http.ClientRequest} = {};

    static readonly MESSAGE_ID_HEADER = 8;
    static readonly MESSAGE_COMMAND_HEADER = 1;

    constructor(options: { channel: string, host: string, proxy: string, target: string, heartBeatInterval?: number, authToken: string }) {
        this.host = options.host;
        this.target = options.target;
        this.proxy = options.proxy;
        this.channel = options.channel;
        this.authToken = options.authToken;
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
        const serverUrl = this.host + "/hoop/" + this.channel + "?" + querystring.stringify({auth: this.authToken});
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
            const idBuffer = data.slice(0, TunnelClient.MESSAGE_ID_HEADER);
            const commandBuffer = data.slice(TunnelClient.MESSAGE_ID_HEADER, TunnelClient.MESSAGE_ID_HEADER + TunnelClient.MESSAGE_COMMAND_HEADER);
            const id = idBuffer.toString("utf-8", 0, TunnelClient.MESSAGE_ID_HEADER);
            const command = commandBuffer.toString();
            console.log(`Tunnel message. id=${id} command=${command}`);
            if (command === "h") {
                const headerBuffer = data.slice(TunnelClient.MESSAGE_ID_HEADER + TunnelClient.MESSAGE_COMMAND_HEADER);
                const header = JSON.parse(headerBuffer.toString());
                const headers = {};
                Object.keys(header.headers).forEach(name => {
                    if(!ignoreHeader(name)){
                        headers[name] = header.headers[name];
                    }
                });
                console.log(header);
                const targetRawUrl = this.target + header.path + (header.query ? `?${header.query}` : "");
                const targetUrl = url.parse(targetRawUrl);
                const options: http.RequestOptions = {
                    method: header.method,
                    headers,
                    timeout: 30000,
                    protocol: targetUrl.protocol,
                    hostname: targetUrl.hostname,
                    port: targetUrl.port,
                    path: targetUrl.path
                };

                this.request[id] = http.request(options);
                this.request[id].on("response", (res: http.IncomingMessage) => {
                    res.on("data", (data: Buffer) => {
                        console.log(`Request command=s`, data.toString());
                        const commandBuffer = new Buffer("s");
                        const message = Buffer.concat([idBuffer, commandBuffer, data]);
                        this.sendToServer(message);
                    });
                    res.on("end", () => {
                        console.log(`Request command=e`);
                        const commandBuffer = new Buffer("e");
                        const message = Buffer.concat([idBuffer, commandBuffer]);
                        this.sendToServer(message);
                        delete this.request[id];
                    });
                    res.on("error", (error) => {
                        console.log(`Request command=a`, error);
                        const commandBuffer = new Buffer("a");
                        const message = Buffer.concat([idBuffer, commandBuffer]);
                        this.sendToServer(message);
                        delete this.request[id];
                    });
                    console.log(`Request command=h`);
                    const commandBuffer = new Buffer("h");
                    const header = JSON.stringify({headers: res.headers, status: res.statusCode});
                    const message = Buffer.concat([idBuffer, commandBuffer, new Buffer(header)]);
                    this.sendToServer(message);
                });
                this.request[id].on("error", (error) => {
                    console.log(`Request command=a`, error);
                    const commandBuffer = new Buffer("a");
                    const message = Buffer.concat([idBuffer, commandBuffer]);
                    this.sendToServer(message);
                    delete this.request[id];
                });
            } else if (command === "s") {
                const dataBuffer = data.slice(TunnelClient.MESSAGE_ID_HEADER + TunnelClient.MESSAGE_COMMAND_HEADER);
                if(this.request[id]) {
                    console.log(dataBuffer.toString());
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
        console.log(new Date(), `Send heart beat. channel=${this.channel}`);
        if (this.ws) {
            const id = uniqueId(TunnelClient.MESSAGE_ID_HEADER);
            this.sendToServer(new Buffer(id));
        }
    }


    private repeatSendHeartBeat(): void {
        clearTimeout(this.heartBeatTimer);
        this.sendHeartBeat();
        this.heartBeatTimer = setTimeout(this.repeatSendHeartBeat.bind(this), this.heartBeatInterval);
    }

    private sendToServer(buffer: Buffer): void {
        if (this.ws) {
            this.ws.send(buffer, (error) => {
                if (error) {
                    console.error(error);
                    if (this.ws) {
                        this.ws.close();
                    }
                }
            });
        }
    }
}

function getProxyFromEnvironment(): string {
    return process.env.https_proxy || process.env.HTTPS_PROXY;
}
const proxy = getProxyFromEnvironment();

const program = commander.version(packageJson.version)
    .option("-c, --channel [value]", "channel")
    .option("-t, --target [value]", "target host to which request are piped")
    .option("-s, --server [value]", "hoop server url (starts with ws[s]://)")
    .option("-a, --auth [value]", "authentication token for the server")
    .parse(process.argv)
const options = program.opts();
if (options.help) {
    program.help();
} else {
    const tunnelClientOptions = {
        channel: options.channel || "test",
        host: options.server || "ws:localhost:80",
        proxy: proxy,
        target: options.target || "http://localhost:8080",
        authToken: options.auth || ""
    }
    Object.keys(tunnelClientOptions).forEach(key => {
        console.log(`${key}=${tunnelClientOptions[key]}`);
    })
    new TunnelClient(tunnelClientOptions);
}