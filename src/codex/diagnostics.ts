const reasons: Array<[RegExp, string]> = [
  [/TOML parse error|failed to (?:parse|load).*config/i, 'configuration parsing failed'],
  [/unknown variant|invalid value/i, 'unsupported configuration value'],
  [/invalid type/i, 'invalid configuration type'],
  [/missing field/i, 'required configuration field missing'],
  [/not logged in|authentication failed|unauthorized|invalid api key/i, 'authentication failed'],
  [/profile.*(?:failed|error)|failed to.*profile/i, 'profile initialization failed'],
  [/permission denied|operation not permitted/i, 'filesystem permission denied'],
  [/no such file or directory/i, 'required file or directory missing'],
  [/address already in use/i, 'endpoint already in use'],
];

export class CodexDiagnostics {
  private tail = '';
  append(chunk: string): void {
    this.tail = (this.tail + chunk).slice(-8192);
  }
  annotate(error: Error): Error {
    if (!this.tail || error.message.includes('\nCodex stderr summary:')) return error;
    // Raw paths, configuration values and credentials never enter model-visible diagnostics.
    const labels = reasons.filter(([pattern]) => pattern.test(this.tail)).map(([, label]) => label);
    const location = /TOML parse error at line (\d{1,6}), column (\d{1,6})/i.exec(this.tail);
    if (location) labels.push(`TOML line ${location[1]}, column ${location[2]}`);
    error.message += `\nCodex stderr summary: ${labels.join('; ') || 'unrecognized diagnostic'}; raw details withheld`;
    return error;
  }
}
