interface Services {
  handlePluginEnter(action: { code: string; type: string; payload: any }): Promise<void>
  readFile(path: string): Promise<Buffer>
  writeFile(path: string, data: ArrayBuffer): Promise<void>
  readDir(path: string): Promise<string[]>
  replaceFiles(files: [string, string][]): Promise<void>
}

interface Window {
  services: Services
}

type DeepPartial<T> = {
  [P in keyof T]?: DeepPartial<T[P]>;
};

interface TinypngConfig {
  list: TinypngConfig.List[];
}

declare namespace TinypngConfig {
  export interface List {
    date: number;
    tempdir: string;
    images: List.Image[];
  }

  export namespace List {
    export interface Image {
      name: string;
      path: string;
      size: number;
      compress: {
        path: string;
        downloadUrl?: string;
        size?: number;
        progress: number;
        canceled?: boolean;
        error?: boolean;
        msg?: string;
      };
    }
  }
}

declare namespace TinypngApi {
  export namespace Upload {
    export interface Response {
      input: Response.Input;
      output: Response.Output;
    }
    export namespace Response {
      export interface Input {
        size: number;
        type: string;
      }
      export interface Output {
        height: number;
        ratio: number;
        size: number;
        type: string;
        url: string;
        width: number;
      }
    }
  }

  export interface Error {
    error: string;
    message: string;
  }
}

interface FilePayload {
  isDirectory: boolean;
  isFile: boolean;
  name: string;
  path: string;
}

type DropPaylod = File & { path: string };
