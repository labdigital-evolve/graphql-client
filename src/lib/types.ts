export type BeforeRequest<TRequestInit extends RequestInit = RequestInit> = (
  fetchOptions?: TRequestInit
) =>
  | Promise<Partial<TRequestInit> | undefined>
  | Partial<TRequestInit>
  | undefined;

export type ResponseWithErrors = {
  errors?: {
    message?: string;
    extensions?: {
      code?: string;
    }[];
  };
};
