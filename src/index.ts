"use strict"

import WebSocket = require("ws");
import superagent = require("superagent");
import HttpsProxyAgent = require("https-proxy-agent");

const channel = "test";
const base = "http://localhost:3000/";
const proxy = process.env.http_proxy;

export type Method = "GET" | "POST" | "PUT" | "DELETE";

export interface RestData{
    method: Method;
    path: string;
    headers: object;
    body?: object;
    status?: number;
}

export interface TunnelMessage{
    command: string;
    session: string;
    data?: RestData;
    channel: string;
    error?: any;
}

function ignoreHeader(header: string): boolean{
    const lower = header.toLowerCase();
    const ignore = ["connection", "host", "content-length"];
    return ignore.indexOf(lower) >= 0;
}

function createRequest(method: Method, url: string){
    if(method === "GET"){
        return superagent.get(url);
    }else if(method === "POST"){
        return superagent.post(url);
    }else if(method === "PUT"){
        return superagent.put(url);
    }else if(method === "DELETE"){
        return superagent.delete(url);
    }else{
        return superagent.head(url);
    }
}

export class TunnelClient{
    private host: string;
    private ws: WebSocket;
    private proxy: string;
    private needsReconnect: boolean = true;
    private reconnectTimer: any = null;
    private channel: string = "test";
    private sendSetNameTimer: any = null;

    constructor(channel: string, host: string, proxy: string){
        this.host = host;
        this.proxy = proxy;
        this.channel = channel;

        this.onOpen = this.onOpen.bind(this);
        this.onClose = this.onClose.bind(this);
        this.onMessage = this.onMessage.bind(this);
        this.connect();
    }

    dispose(){
        this.needsReconnect = false;
        this.ws.close();
    }

    private connect(){
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;

        const agent = new HttpsProxyAgent(this.proxy);
        this.ws = new WebSocket(this.host, {agent: agent});
        this.ws.on("open", this.onOpen);
        this.ws.on("close", this.onClose);
        this.ws.on("message", this.onMessage);
    }

    private onOpen(){
        console.log(new Date(), "Websocket connection open.");
        this.repeateSendChannelName();
    }

    private onClose(code: string, reason: string): void{
        clearTimeout(this.sendSetNameTimer);

        if(this.ws){
            this.ws.removeAllListeners();
            this.ws = null;
        }

        if(this.needsReconnect && !this.reconnectTimer){
            this.reconnectTimer = setTimeout(this.connect.bind(this), 3000);
        }
    }

    private onMessage(message: string): void{
        const json:TunnelMessage = JSON.parse(message.toString());
        const session = json.session;
        if(json.command === "request"){
            console.log(json.data)
            const url =  base + json.data.path;
            const request = createRequest(json.data.method, url);
            Object.keys(json.data.headers).forEach((header )=> {
                if(ignoreHeader(header)){
                    // do nothing
                }else{
                    request.set(header, json.data.headers[header]);
                }
            });
            if(json.data.body){
                request.send(json.data.body);
            }
            request.end((error, res) => {
                if (res){
                    const reply: TunnelMessage = {
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
                }else{
                    console.log(error);
                    const errorReply: TunnelMessage = {
                        command: "error",
                        channel: channel,
                        session: session,
                        error: String(error)
                    };
                    console.log(errorReply);
                    this.ws.send(JSON.stringify(errorReply));
                }
            })
        }
    }

    private sendChannelName(): void{
        console.log(new Date(), `Send set-name command. channel=${channel}`);
        const setName:TunnelMessage = {
            command: "set-name",
            channel: this.channel,
            data: null,
            session: null
        };
        this.ws.send(JSON.stringify(setName));
    }


    private repeateSendChannelName(): void{
        clearTimeout(this.sendSetNameTimer);
        this.sendChannelName();
        this.sendSetNameTimer = setTimeout(this.repeateSendChannelName.bind(this), 5000);
    }
}

const tunnel = new TunnelClient("test", "wss://hoop-server.herokuapp.com/", proxy);