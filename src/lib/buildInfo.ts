declare const __F1PW_BUILD_VERSION__: string;

export const BUILD_VERSION: string =
  typeof __F1PW_BUILD_VERSION__ === "string" && __F1PW_BUILD_VERSION__ ? __F1PW_BUILD_VERSION__ : "v dev";
