if (process.versions.node !== '26.10.0') {
  throw new Error(`Node 26.10.0 is required; found ${process.versions.node}`);
}
