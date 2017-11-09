"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const WebSocket = require("ws");
const superagent = require("superagent");
const HttpsProxyAgent = require("https-proxy-agent");
const channel = "test";
const base = "http://localhost:3000/";
const proxy = process.env.http_proxy;
function ignoreHeader(header) {
    const lower = header.toLowerCase();
    const ignore = ["connection", "host", "content-length"];
    return ignore.indexOf(lower) >= 0;
}
function createRequest(method, url) {
    if (method === "GET") {
        return superagent.get(url);
    }
    else if (method === "POST") {
        return superagent.post(url);
    }
    else if (method === "PUT") {
        return superagent.put(url);
    }
    else if (method === "DELETE") {
        return superagent.delete(url);
    }
    else {
        return superagent.head(url);
    }
}
class TunnelClient {
    constructor(channel, host, proxy) {
        this.needsReconnect = true;
        this.reconnectTimer = null;
        this.channel = "test";
        this.sendSetNameTimer = null;
        this.host = host;
        this.proxy = proxy;
        this.channel = channel;
        this.onOpen = this.onOpen.bind(this);
        this.onClose = this.onClose.bind(this);
        this.onMessage = this.onMessage.bind(this);
        this.connect();
    }
    dispose() {
        this.needsReconnect = false;
        this.ws.close();
    }
    connect() {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        const agent = new HttpsProxyAgent(this.proxy);
        this.ws = new WebSocket(this.host, { agent: agent });
        this.ws.on("open", this.onOpen);
        this.ws.on("close", this.onClose);
        this.ws.on("message", this.onMessage);
    }
    onOpen() {
        console.log(new Date(), "Websocket connection open.");
        this.repeateSendChannelName();
    }
    onClose(code, reason) {
        clearTimeout(this.sendSetNameTimer);
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws = null;
        }
        if (this.needsReconnect && !this.reconnectTimer) {
            this.reconnectTimer = setTimeout(this.connect.bind(this), 3000);
        }
    }
    onMessage(message) {
        const json = JSON.parse(message.toString());
        const session = json.session;
        if (json.command === "request") {
            console.log(json.data);
            const url = base + json.data.path;
            const request = createRequest(json.data.method, url);
            Object.keys(json.data.headers).forEach((header) => {
                if (ignoreHeader(header)) {
                    // do nothing
                }
                else {
                    request.set(header, json.data.headers[header]);
                }
            });
            if (json.data.body) {
                request.send(json.data.body);
            }
            request.end((error, res) => {
                if (res) {
                    const reply = {
                        command: "response",
                        channel: channel,
                        session: session,
                        data: {
                            method: json.data.method,
                            body: res.body,
                            path: json.data.path,
                            headers: res.header,
                            status: res.status
                        }
                    };
                    console.log(reply);
                    this.ws.send(JSON.stringify(reply));
                }
                else {
                    console.log(error);
                    const errorReply = {
                        command: "error",
                        channel: channel,
                        session: session,
                        error: String(error)
                    };
                    console.log(errorReply);
                    this.ws.send(JSON.stringify(errorReply));
                }
            });
        }
    }
    sendChannelName() {
        console.log(new Date(), `Send set-name command. channel=${channel}`);
        const setName = {
            command: "set-name",
            channel: this.channel,
            data: null,
            session: null
        };
        this.ws.send(JSON.stringify(setName));
    }
    repeateSendChannelName() {
        clearTimeout(this.sendSetNameTimer);
        this.sendChannelName();
        this.sendSetNameTimer = setTimeout(this.repeateSendChannelName.bind(this), 5000);
    }
}
exports.TunnelClient = TunnelClient;
const tunnel = new TunnelClient("test", "wss://hoop-server.herokuapp.com/", proxy);
