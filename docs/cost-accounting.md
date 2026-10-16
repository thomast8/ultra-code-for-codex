# Worker credit estimates

The panel reports observed worker tokens and an **estimate at the published Standard credit rates**. It does not show an actual charge. The [OpenAI ChatGPT Work and Codex rate card](https://help.openai.com/en/articles/11481834-chatgpt-rate-card-business-enterpriseedu-credit-based-pricing) was checked on 15 October 2026. Account plan, included allowance, speed mode, and later rate changes can change what is charged. Main-chat usage is not reported to this plugin, so it is excluded.

For each worker with a verified reported model, the panel calculates:

```text
new input = input - cached input - cache writes
Standard credit equivalent = (new input × input rate
  + cached input × cached rate + output × output rate) / 1,000,000
```

Reasoning tokens are already part of output; cached input is already part of input. They are never added again. Codex cache writes are free under the published rate card. If a historical worker has no cache-write count, the panel shows a conditional range: the low end assumes all remaining uncached input was a free write; the high end assumes none was. A model that was never reported, inconsistent token subsets, or run/task totals that disagree produce **unknown**, not a guessed estimate. Usage while a worker is active remains partial.

For the two observed GPT-6 Luna workers with input/cached/output counts of 168,686/132,608/2,237 and 135,416/97,024/2,684, the combined Standard-rate equivalent is **0.1189205–0.3050955 credits** because cache writes were not reported. This is not a billed-credit or dollar amount.

The observed-token threshold is soft. A run with a 50,000-token setting warns as soon as a reported usage update reaches that total, displays the overshoot, and blocks later worker dispatch. A worker already running is allowed to finish, so its final usage can exceed the threshold. Crossing it does not mark its answer accepted or rejected.
