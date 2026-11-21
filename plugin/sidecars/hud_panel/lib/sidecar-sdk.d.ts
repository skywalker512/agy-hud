declare module 'sidecar_sdk' {
  export class Response {
    constructor(
      body: string | Buffer,
      options?: { contentType?: string; headers?: Record<string, string>; status?: number },
    );
  }
  export class SidecarApp {
    config?: Record<string, any>;
    page(route: string, handler: (data?: any) => any): void;
    api(route: string, handler: (data?: any) => any, method?: string): void;
    run(): void;
  }
}
