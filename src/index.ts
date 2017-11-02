import WebSocket = require("ws");
import superagent = require("superagent");

const channel = "test";
const base = "http://localhost:3000/"
const ws = new WebSocket("ws://localhost:8080");

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


ws.on("open", ()=>{
    console.log("open");
    const setName:TunnelMessage = {
        command: "set-name",
        channel: channel,
        data: null,
        session: null
    };
    ws.send(JSON.stringify(setName));
});

ws.on("close", ()=>{
    console.log("close");
})

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

ws.on("message", (message)=>{
    const json:TunnelMessage = JSON.parse(message.toString());
    const session = json.session;
    if(json.command === "request"){
        console.log(json)
        const request = createRequest(json.data.method, base + json.data.path);
        Object.keys(json.data.headers).forEach((key )=> {
            if(ignoreHeader(key)){
                // do nothing
            }else{
                request.set(key, json.data.headers[key]);
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
                ws.send(JSON.stringify(reply));
            }else{
                console.log(error);
                const reply: TunnelMessage = {
                    command: "error",
                    channel: channel,
                    session: session,
                    error: String(error)
                };
                ws.send(JSON.stringify(reply));
            }
        })
    }
});