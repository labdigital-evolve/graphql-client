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
