export interface GenerateOptions {
  model?: string;
  apiKey?: string;
  signal?: AbortSignal;
  jsonMode?: boolean;
}

export interface AIProvider {
  getName(): string;
  isAvailable(): Promise<boolean>;
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
}
