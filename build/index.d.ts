export declare type Method = "GET" | "POST" | "PUT" | "DELETE";
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
export declare class TunnelClient {
    private host;
    private ws;
    private proxy;
    private needsReconnect;
    private reconnectTimer;
    private channel;
    private sendSetNameTimer;
    constructor(channel: string, host: string, proxy: string);
    dispose(): void;
    private connect();
    private onOpen();
    private onClose(code, reason);
    private onMessage(message);
    private sendChannelName();
    private repeateSendChannelName();
}
