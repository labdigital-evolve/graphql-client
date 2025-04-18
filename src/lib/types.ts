export type BeforeRequest<TRequestInit extends RequestInit = RequestInit> = (
  mergedFetchOptions: TRequestInit
) => Promise<TRequestInit> | TRequestInit;

export type ResponseWithErrors = {
  errors?: {
    message?: string;
    extensions?: {
      code?: string;
    }[];
  };
};

export class GraphQLClientError extends Error {
  response: Response;

  constructor(message: string, response: Response) {
    super(message);
    this.name = "GraphQLClientError";
    this.response = response;
    // Ensure prototype chain is correct
    Object.setPrototypeOf(this, GraphQLClientError.prototype);
  }
}
