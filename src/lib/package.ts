import packageJson from "../../package.json";

export function getPackageVersion(): string {
  return packageJson.version;
}

export function getPackageName(): string {
  return packageJson.name;
}
