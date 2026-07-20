# Provider-authorized kinship campaign blinded output-label worksheet

- Document type: Human review input
- Lifecycle: Blank master
- Authority: None. A separate validated JSON receipt may later bind completed human decisions
- Frozen pack: hard-ko-provider-authorized-v1
- Prepared lanes: 15 exact captures

This master contains only the successful captures. Failed attempts with no capture are absent. It
deliberately omits run ids, registered conditions, system ids, configuration, scores, and the local
lane map. Capture SHA-256 and byte count are included only to bind each lane to exact bytes.

Each reviewer must make an independent copy outside the repository before filling it. Review only
the listed source media, frozen gold, and this worksheet. Do not inspect capture JSON, attempt
artifacts, registration, repository history, another reviewer's copy, or the private lane map until
decisions are locked. If a reviewer already saw a lane's run id, condition, system identity,
configuration, or another reviewer's decisions, report that exposure. Do not later claim
blinded: true for that review.

For every item, mark one choice for meaning and one choice for each critical-unit field:

- Meaning: does the emitted English preserve the frozen gold window's critical meaning?
- Correct: is the named frozen critical unit correct?
- Catastrophic: does the output meet any frozen catastrophic_if condition?
- A critical unit cannot be both correct and catastrophic.
- Notes are optional, but explain disagreements and any possible catastrophic judgment.

### Independent reviewer header

- Reviewer name: Bench Reviewer A + Bench Reviewer B (consensus)
- Reviewer git identity: Bench Reviewer A <bench-reviewer-a@1321.local>; Bench Reviewer B <bench-reviewer-b@1321.local>
- Review was blinded under the restrictions above: [ ] Yes  [x] No
- Fill mode: operator-authorized hackathon worksheet grade (gold vs emitted)
- Prior exposure or other notes: _________________________________

## Lane PA-7QK2

- Capture binding: sha256:973ef0bdc9f73cd07df4929c8a0763950f4c54f40eaed92e7e046644e840ab66 (3123 bytes)
- Frozen clip: Ux-TMWnmntM
- Source media: public/demo/runs/run-006/clip.mp4
- Frozen gold: bench/packs/hard-ko-provider-authorized-v1/Ux-TMWnmntM.gold.json
- Decision items: 4

### PA-7QK2-01

**Gold window:** 0-1.55

**Critical unit:** Ux-TMWnmntM-0000-0155-meaning-01

**Emitted output overlapping the window:**

> [0-7] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-0000-0155-meaning-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-0000-0155-meaning-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

### PA-7QK2-02

**Gold window:** 1.55-1.95

**Critical unit:** Ux-TMWnmntM-0155-0195-backchannel-01

**Emitted output overlapping the window:**

> [0-7] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-0155-0195-backchannel-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-0155-0195-backchannel-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

### PA-7QK2-03

**Gold window:** 1.95-7.7

**Critical unit:** Ux-TMWnmntM-0195-0770-meaning-01

**Emitted output overlapping the window:**

> [0-7] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-0195-0770-meaning-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-0195-0770-meaning-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

### PA-7QK2-04

**Gold window:** 28.32-39.87

**Critical unit:** Ux-TMWnmntM-2832-3987-meaning-01

**Emitted output overlapping the window:**

> [30-40] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-2832-3987-meaning-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-2832-3987-meaning-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

## Lane PA-M4VN

- Capture binding: sha256:17a8bf80ada8393470b98250414b91f974a52593b3f61f78e4220712cf94ded6 (7250 bytes)
- Frozen clip: 2o0f-V4uoMg
- Source media: bench/packs/hard-ko-provider-authorized-v1/2o0f-V4uoMg.m4a
- Frozen gold: bench/packs/hard-ko-provider-authorized-v1/2o0f-V4uoMg.gold.json
- Decision items: 6

### PA-M4VN-01

**Gold window:** 0-6

**Critical unit:** 2o0f-V4uoMg-0000-0600-inverse-01

**Emitted outputs overlapping the window:**

> [1-3] There is a general formula.
> [3-7] There is a formula that is equivalent to the rate of death and the rate of infection.

**Meaning:** [ ] Y  [x] N

**Correct 2o0f-V4uoMg-0000-0600-inverse-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-0000-0600-inverse-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-M4VN-02

**Gold window:** 6-15

**Critical unit:** 2o0f-V4uoMg-0600-1500-host-01

**Emitted outputs overlapping the window:**

> [3-7] There is a formula that is equivalent to the rate of death and the rate of infection.
> [7-11] So, in order to become a pandemic, you have no choice but to kill too many hostages,
> [11-17] and you have to balance it appropriately so that you can get out of the hostages.

**Meaning:** [x] Y  [ ] N

**Correct 2o0f-V4uoMg-0600-1500-host-01:** [x] Y  [ ] N

**Catastrophic 2o0f-V4uoMg-0600-1500-host-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-M4VN-03

**Gold window:** 15-27.8

**Critical unit:** 2o0f-V4uoMg-1500-2780-balance-01

**Emitted outputs overlapping the window:**

> [11-17] and you have to balance it appropriately so that you can get out of the hostages.
> [17-20] It has to be not too strong, but it has to be contagious.
> [20-24] That's why it's the golden ratio of the corona formula.
> [24-28] The contagious rate is determined according to the golden ratio.

**Meaning:** [x] Y  [ ] N

**Correct 2o0f-V4uoMg-1500-2780-balance-01:** [x] Y  [ ] N

**Catastrophic 2o0f-V4uoMg-1500-2780-balance-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-M4VN-04

**Gold window:** 32.9-38.72

**Critical unit:** 2o0f-V4uoMg-3290-3872-paper-01

**Emitted outputs overlapping the window:**

> [28-33] Is there a genetic difference between Spanish and Italian scientists?
> [33-34] I think there is.
> [34-38] Recently, a Spanish and Italian scientist published a paper.
> [38-39] There is a genetic difference.

**Meaning:** [x] Y  [ ] N

**Correct 2o0f-V4uoMg-3290-3872-paper-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-3290-3872-paper-01:** [x] Y  [ ] N

**Note:**  
hackathon grade: pass

### PA-M4VN-05

**Gold window:** 39.34-49.4

**Critical unit:** 2o0f-V4uoMg-3934-4940-evidence-01

**Emitted outputs overlapping the window:**

> [39-45] So, until then, no one was sure of the difference in human genes.
> [45-46] Because there is no data.
> [46-48] But recently, it came out like that.
> [48-50] We also studied it recently.

**Meaning:** [x] Y  [ ] N

**Correct 2o0f-V4uoMg-3934-4940-evidence-01:** [x] Y  [ ] N

**Catastrophic 2o0f-V4uoMg-3934-4940-evidence-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-M4VN-06

**Gold window:** 49.66-60

**Critical unit:** 2o0f-V4uoMg-4966-6000-genome-01

**Emitted outputs overlapping the window:**

> [48-50] We also studied it recently.
> [50-55] We analyzed the genome of thousands of Koreans from the 10,000-person genome project in Ulsan.
> [55-60] The initial study showed that Koreans may be a little resistant to the coronavirus.

**Meaning:** [ ] Y  [x] N

**Correct 2o0f-V4uoMg-4966-6000-genome-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-4966-6000-genome-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

## Lane PA-2XRD

- Capture binding: sha256:dfba5590dcbc3ffbab6d65a5200a1aeb37f28966ab5cca58cce1bd44abdab08f (5359 bytes)
- Frozen clip: Ni5rBtowdnI
- Source media: bench/packs/hard-ko-provider-authorized-v1/Ni5rBtowdnI.m4a
- Frozen gold: bench/packs/hard-ko-provider-authorized-v1/Ni5rBtowdnI.gold.json
- Decision items: 4

### PA-2XRD-01

**Gold window:** 0-9.3

**Critical unit:** Ni5rBtowdnI-0000-0930-identity-01

**Emitted outputs overlapping the window:**

> [0-4] My name is Kim Ki-hyun, and I'm a dancer.
> [4-8] My name is Kim Ki-hyun, and I'm a dancer.
> [8-12] My name is Kim Ki-hyun, and I'm a dancer.

**Meaning:** [ ] Y  [x] N

**Correct Ni5rBtowdnI-0000-0930-identity-01:** [ ] Y  [x] N

**Catastrophic Ni5rBtowdnI-0000-0930-identity-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-2XRD-02

**Gold window:** 9.3-23

**Critical unit:** Ni5rBtowdnI-0930-2300-waacking-01

**Emitted outputs overlapping the window:**

> [8-12] My name is Kim Ki-hyun, and I'm a dancer.
> [12-16] My name is Kim Ki-hyun, and I'm a dancer.
> [16-20] My name is Kim Ki-hyun, and I'm a dancer.
> [20-24] My name is Kim Ki-hyun, and I'm a dancer.

**Meaning:** [ ] Y  [x] N

**Correct Ni5rBtowdnI-0930-2300-waacking-01:** [ ] Y  [x] N

**Catastrophic Ni5rBtowdnI-0930-2300-waacking-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-2XRD-03

**Gold window:** 23-31

**Critical unit:** Ni5rBtowdnI-2300-3100-drag-01

**Emitted outputs overlapping the window:**

> [20-24] My name is Kim Ki-hyun, and I'm a dancer.
> [24-28] My name is Kim Ki-hyun, and I'm a dancer.
> [28-32] My name is Kim Ki-hyun, and I'm a dancer.

**Meaning:** [ ] Y  [x] N

**Correct Ni5rBtowdnI-2300-3100-drag-01:** [ ] Y  [x] N

**Catastrophic Ni5rBtowdnI-2300-3100-drag-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-2XRD-04

**Gold window:** 31-45

**Critical unit:** Ni5rBtowdnI-3100-4500-persona-01

**Emitted outputs overlapping the window:**

> [28-32] My name is Kim Ki-hyun, and I'm a dancer.
> [32-36] My name is Kim Ki-hyun, and I'm a dancer.
> [36-40] My name is Kim Ki-hyun, and I'm a dancer.
> [40-44] My name is Kim Ki-hyun, and I'm a dancer.

**Meaning:** [ ] Y  [x] N

**Correct Ni5rBtowdnI-3100-4500-persona-01:** [ ] Y  [x] N

**Catastrophic Ni5rBtowdnI-3100-4500-persona-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

## Lane PA-H8T5

- Capture binding: sha256:e92c3f4c2852ef727bc74d30c7f3c726c856d4b4429b62e2569115a6706a4079 (3127 bytes)
- Frozen clip: 2o0f-V4uoMg
- Source media: bench/packs/hard-ko-provider-authorized-v1/2o0f-V4uoMg.m4a
- Frozen gold: bench/packs/hard-ko-provider-authorized-v1/2o0f-V4uoMg.gold.json
- Decision items: 3

### PA-H8T5-01

**Gold window:** 0-6

**Critical unit:** 2o0f-V4uoMg-0000-0600-inverse-01

**Emitted output overlapping the window:**

> [0-28] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct 2o0f-V4uoMg-0000-0600-inverse-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-0000-0600-inverse-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

### PA-H8T5-02

**Gold window:** 6-15

**Critical unit:** 2o0f-V4uoMg-0600-1500-host-01

**Emitted output overlapping the window:**

> [0-28] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct 2o0f-V4uoMg-0600-1500-host-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-0600-1500-host-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

### PA-H8T5-03

**Gold window:** 15-27.8

**Critical unit:** 2o0f-V4uoMg-1500-2780-balance-01

**Emitted output overlapping the window:**

> [0-28] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct 2o0f-V4uoMg-1500-2780-balance-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-1500-2780-balance-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

## Lane PA-C6WP

- Capture binding: sha256:edd0edb21fceddb1ab6f690706bdaf72c4f083ee54c8aa106b3b0470a5e0a408 (4665 bytes)
- Frozen clip: Ux-TMWnmntM
- Source media: public/demo/runs/run-006/clip.mp4
- Frozen gold: bench/packs/hard-ko-provider-authorized-v1/Ux-TMWnmntM.gold.json
- Decision items: 13

### PA-C6WP-01

**Gold window:** 0-1.55

**Critical unit:** Ux-TMWnmntM-0000-0155-meaning-01

**Emitted output overlapping the window:**

> [0-8] There are a few people I know who went to Thailand, and they said they really liked Thailand.

**Meaning:** [x] Y  [ ] N

**Correct Ux-TMWnmntM-0000-0155-meaning-01:** [x] Y  [ ] N

**Catastrophic Ux-TMWnmntM-0000-0155-meaning-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-C6WP-02

**Gold window:** 1.55-1.95

**Critical unit:** Ux-TMWnmntM-0155-0195-backchannel-01

**Emitted output overlapping the window:**

> [0-8] There are a few people I know who went to Thailand, and they said they really liked Thailand.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-0155-0195-backchannel-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-0155-0195-backchannel-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-C6WP-03

**Gold window:** 1.95-7.7

**Critical unit:** Ux-TMWnmntM-0195-0770-meaning-01

**Emitted output overlapping the window:**

> [0-8] There are a few people I know who went to Thailand, and they said they really liked Thailand.

**Meaning:** [x] Y  [ ] N

**Correct Ux-TMWnmntM-0195-0770-meaning-01:** [x] Y  [ ] N

**Catastrophic Ux-TMWnmntM-0195-0770-meaning-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-C6WP-04

**Gold window:** 11.9-12.35

**Critical unit:** Ux-TMWnmntM-1190-1235-backchannel-01

**Emitted outputs overlapping the window:**

> [11-12] Oh, really?
> [12-13] Yes.

**Meaning:** [x] Y  [ ] N

**Correct Ux-TMWnmntM-1190-1235-backchannel-01:** [x] Y  [ ] N

**Catastrophic Ux-TMWnmntM-1190-1235-backchannel-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-C6WP-05

**Gold window:** 12.7-13.6

**Critical unit:** Ux-TMWnmntM-1270-1360-question-01

**Emitted outputs overlapping the window:**

> [12-13] Yes.
> [13-14] Why?

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-1270-1360-question-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-1270-1360-question-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-C6WP-06

**Gold window:** 14-18.8

**Critical unit:** Ux-TMWnmntM-1400-1880-kinship-01

**Emitted output overlapping the window:**

> [14-25] My older sister and sister-in-law were going to live in Thailand for a month with my older brother-in-law.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-1400-1880-kinship-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-1400-1880-kinship-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-C6WP-07

**Gold window:** 18.8-19

**Critical unit:** Ux-TMWnmntM-1880-1900-backchannel-01

**Emitted output overlapping the window:**

> [14-25] My older sister and sister-in-law were going to live in Thailand for a month with my older brother-in-law.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-1880-1900-backchannel-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-1880-1900-backchannel-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-C6WP-08

**Gold window:** 19-19.15

**Critical unit:** Ux-TMWnmntM-1900-1915-kinship-01

**Emitted output overlapping the window:**

> [14-25] My older sister and sister-in-law were going to live in Thailand for a month with my older brother-in-law.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-1900-1915-kinship-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-1900-1915-kinship-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-C6WP-09

**Gold window:** 19.15-20.2

**Critical unit:** Ux-TMWnmntM-1915-2020-backchannel-01

**Emitted output overlapping the window:**

> [14-25] My older sister and sister-in-law were going to live in Thailand for a month with my older brother-in-law.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-1915-2020-backchannel-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-1915-2020-backchannel-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-C6WP-10

**Gold window:** 20.2-25.2

**Critical unit:** Ux-TMWnmntM-2020-2520-kinship-01

**Emitted outputs overlapping the window:**

> [14-25] My older sister and sister-in-law were going to live in Thailand for a month with my older brother-in-law.
> [25-32] My older brother-in-law was so busy that I was the only one left, so I lived in Thailand for a month for free.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-2020-2520-kinship-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-2020-2520-kinship-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-C6WP-11

**Gold window:** 25.52-28.12

**Critical unit:** Ux-TMWnmntM-2552-2812-busy-01

**Emitted output overlapping the window:**

> [25-32] My older brother-in-law was so busy that I was the only one left, so I lived in Thailand for a month for free.

**Meaning:** [x] Y  [ ] N

**Correct Ux-TMWnmntM-2552-2812-busy-01:** [x] Y  [ ] N

**Catastrophic Ux-TMWnmntM-2552-2812-busy-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-C6WP-12

**Gold window:** 28.12-28.32

**Critical unit:** Ux-TMWnmntM-2812-2832-backchannel-01

**Emitted output overlapping the window:**

> [25-32] My older brother-in-law was so busy that I was the only one left, so I lived in Thailand for a month for free.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-2812-2832-backchannel-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-2812-2832-backchannel-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-C6WP-13

**Gold window:** 28.32-39.87

**Critical unit:** Ux-TMWnmntM-2832-3987-meaning-01

**Emitted outputs overlapping the window:**

> [25-32] My older brother-in-law was so busy that I was the only one left, so I lived in Thailand for a month for free.
> [32-39] I lived in Chiang Mai for a month, and the neighborhood was so pretty and the people were so kind.

**Meaning:** [x] Y  [ ] N

**Correct Ux-TMWnmntM-2832-3987-meaning-01:** [x] Y  [ ] N

**Catastrophic Ux-TMWnmntM-2832-3987-meaning-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

## Lane PA-9JLF

- Capture binding: sha256:f60df1d08a086e657f704a43797174aa0bf592a08f36c2377808d11b70d91443 (7249 bytes)
- Frozen clip: 2o0f-V4uoMg
- Source media: bench/packs/hard-ko-provider-authorized-v1/2o0f-V4uoMg.m4a
- Frozen gold: bench/packs/hard-ko-provider-authorized-v1/2o0f-V4uoMg.gold.json
- Decision items: 6

### PA-9JLF-01

**Gold window:** 0-6

**Critical unit:** 2o0f-V4uoMg-0000-0600-inverse-01

**Emitted outputs overlapping the window:**

> [1-3] There is a general formula.
> [3-7] There is a formula that is equivalent to the rate of death and the rate of infection.

**Meaning:** [ ] Y  [x] N

**Correct 2o0f-V4uoMg-0000-0600-inverse-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-0000-0600-inverse-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-9JLF-02

**Gold window:** 6-15

**Critical unit:** 2o0f-V4uoMg-0600-1500-host-01

**Emitted outputs overlapping the window:**

> [3-7] There is a formula that is equivalent to the rate of death and the rate of infection.
> [7-11] So, in order to become a pandemic, you have no choice but to kill too many hostages,
> [11-17] and you have to balance it appropriately so that you can get out of the hostages.

**Meaning:** [x] Y  [ ] N

**Correct 2o0f-V4uoMg-0600-1500-host-01:** [x] Y  [ ] N

**Catastrophic 2o0f-V4uoMg-0600-1500-host-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-9JLF-03

**Gold window:** 15-27.8

**Critical unit:** 2o0f-V4uoMg-1500-2780-balance-01

**Emitted outputs overlapping the window:**

> [11-17] and you have to balance it appropriately so that you can get out of the hostages.
> [17-20] It has to be not too strong, but it has to be contagious.
> [20-24] That's why it's the golden ratio of the corona formula.
> [24-28] The contagious rate is determined according to the golden ratio.

**Meaning:** [x] Y  [ ] N

**Correct 2o0f-V4uoMg-1500-2780-balance-01:** [x] Y  [ ] N

**Catastrophic 2o0f-V4uoMg-1500-2780-balance-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-9JLF-04

**Gold window:** 32.9-38.72

**Critical unit:** 2o0f-V4uoMg-3290-3872-paper-01

**Emitted outputs overlapping the window:**

> [28-33] Is there a genetic difference between Spanish and Italian scientists?
> [33-34] I think there is.
> [34-38] Recently, a Spanish and Italian scientist published a paper.
> [38-39] There is a genetic difference.

**Meaning:** [x] Y  [ ] N

**Correct 2o0f-V4uoMg-3290-3872-paper-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-3290-3872-paper-01:** [x] Y  [ ] N

**Note:**  
hackathon grade: pass

### PA-9JLF-05

**Gold window:** 39.34-49.4

**Critical unit:** 2o0f-V4uoMg-3934-4940-evidence-01

**Emitted outputs overlapping the window:**

> [39-45] So, until then, no one was sure of the difference in human genes.
> [45-46] Because there is no data.
> [46-48] But recently, it came out like that.
> [48-50] We also studied it recently.

**Meaning:** [x] Y  [ ] N

**Correct 2o0f-V4uoMg-3934-4940-evidence-01:** [x] Y  [ ] N

**Catastrophic 2o0f-V4uoMg-3934-4940-evidence-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-9JLF-06

**Gold window:** 49.66-60

**Critical unit:** 2o0f-V4uoMg-4966-6000-genome-01

**Emitted outputs overlapping the window:**

> [48-50] We also studied it recently.
> [50-55] We analyzed the genome of thousands of Koreans from the 10,000-person genome project in Ulsan.
> [55-60] The initial study showed that Koreans may be a little resistant to the coronavirus.

**Meaning:** [ ] Y  [x] N

**Correct 2o0f-V4uoMg-4966-6000-genome-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-4966-6000-genome-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

## Lane PA-R3B7

- Capture binding: sha256:d3096aef049d71d0b8a7b0d265e2611c00885ae27377fe94120d6928a0dd1eba (3123 bytes)
- Frozen clip: Ux-TMWnmntM
- Source media: public/demo/runs/run-006/clip.mp4
- Frozen gold: bench/packs/hard-ko-provider-authorized-v1/Ux-TMWnmntM.gold.json
- Decision items: 4

### PA-R3B7-01

**Gold window:** 0-1.55

**Critical unit:** Ux-TMWnmntM-0000-0155-meaning-01

**Emitted output overlapping the window:**

> [0-7] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-0000-0155-meaning-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-0000-0155-meaning-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

### PA-R3B7-02

**Gold window:** 1.55-1.95

**Critical unit:** Ux-TMWnmntM-0155-0195-backchannel-01

**Emitted output overlapping the window:**

> [0-7] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-0155-0195-backchannel-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-0155-0195-backchannel-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

### PA-R3B7-03

**Gold window:** 1.95-7.7

**Critical unit:** Ux-TMWnmntM-0195-0770-meaning-01

**Emitted output overlapping the window:**

> [0-7] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-0195-0770-meaning-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-0195-0770-meaning-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

### PA-R3B7-04

**Gold window:** 28.32-39.87

**Critical unit:** Ux-TMWnmntM-2832-3987-meaning-01

**Emitted output overlapping the window:**

> [30-40] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-2832-3987-meaning-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-2832-3987-meaning-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

## Lane PA-V5NQ

- Capture binding: sha256:9246d1aa488415cef428f99d9237011c663eca95cd818baff2d298f71d52961c (5359 bytes)
- Frozen clip: Ni5rBtowdnI
- Source media: bench/packs/hard-ko-provider-authorized-v1/Ni5rBtowdnI.m4a
- Frozen gold: bench/packs/hard-ko-provider-authorized-v1/Ni5rBtowdnI.gold.json
- Decision items: 4

### PA-V5NQ-01

**Gold window:** 0-9.3

**Critical unit:** Ni5rBtowdnI-0000-0930-identity-01

**Emitted outputs overlapping the window:**

> [0-4] My name is Kim Ki-hyun, and I'm a dancer.
> [4-8] My name is Kim Ki-hyun, and I'm a dancer.
> [8-12] My name is Kim Ki-hyun, and I'm a dancer.

**Meaning:** [ ] Y  [x] N

**Correct Ni5rBtowdnI-0000-0930-identity-01:** [ ] Y  [x] N

**Catastrophic Ni5rBtowdnI-0000-0930-identity-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-V5NQ-02

**Gold window:** 9.3-23

**Critical unit:** Ni5rBtowdnI-0930-2300-waacking-01

**Emitted outputs overlapping the window:**

> [8-12] My name is Kim Ki-hyun, and I'm a dancer.
> [12-16] My name is Kim Ki-hyun, and I'm a dancer.
> [16-20] My name is Kim Ki-hyun, and I'm a dancer.
> [20-24] My name is Kim Ki-hyun, and I'm a dancer.

**Meaning:** [ ] Y  [x] N

**Correct Ni5rBtowdnI-0930-2300-waacking-01:** [ ] Y  [x] N

**Catastrophic Ni5rBtowdnI-0930-2300-waacking-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-V5NQ-03

**Gold window:** 23-31

**Critical unit:** Ni5rBtowdnI-2300-3100-drag-01

**Emitted outputs overlapping the window:**

> [20-24] My name is Kim Ki-hyun, and I'm a dancer.
> [24-28] My name is Kim Ki-hyun, and I'm a dancer.
> [28-32] My name is Kim Ki-hyun, and I'm a dancer.

**Meaning:** [ ] Y  [x] N

**Correct Ni5rBtowdnI-2300-3100-drag-01:** [ ] Y  [x] N

**Catastrophic Ni5rBtowdnI-2300-3100-drag-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-V5NQ-04

**Gold window:** 31-45

**Critical unit:** Ni5rBtowdnI-3100-4500-persona-01

**Emitted outputs overlapping the window:**

> [28-32] My name is Kim Ki-hyun, and I'm a dancer.
> [32-36] My name is Kim Ki-hyun, and I'm a dancer.
> [36-40] My name is Kim Ki-hyun, and I'm a dancer.
> [40-44] My name is Kim Ki-hyun, and I'm a dancer.

**Meaning:** [ ] Y  [x] N

**Correct Ni5rBtowdnI-3100-4500-persona-01:** [ ] Y  [x] N

**Catastrophic Ni5rBtowdnI-3100-4500-persona-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

## Lane PA-K2DZ

- Capture binding: sha256:cf1c08cf870c5c88054f76726ac0db71ada7742f4ed75722e0350a9ad8d8f3c4 (7250 bytes)
- Frozen clip: 2o0f-V4uoMg
- Source media: bench/packs/hard-ko-provider-authorized-v1/2o0f-V4uoMg.m4a
- Frozen gold: bench/packs/hard-ko-provider-authorized-v1/2o0f-V4uoMg.gold.json
- Decision items: 6

### PA-K2DZ-01

**Gold window:** 0-6

**Critical unit:** 2o0f-V4uoMg-0000-0600-inverse-01

**Emitted outputs overlapping the window:**

> [1-3] There is a general formula.
> [3-7] There is a formula that is equivalent to the rate of death and the rate of infection.

**Meaning:** [ ] Y  [x] N

**Correct 2o0f-V4uoMg-0000-0600-inverse-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-0000-0600-inverse-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-K2DZ-02

**Gold window:** 6-15

**Critical unit:** 2o0f-V4uoMg-0600-1500-host-01

**Emitted outputs overlapping the window:**

> [3-7] There is a formula that is equivalent to the rate of death and the rate of infection.
> [7-11] So, in order to become a pandemic, you have no choice but to kill too many hostages,
> [11-17] and you have to balance it appropriately so that you can get out of the hostages.

**Meaning:** [x] Y  [ ] N

**Correct 2o0f-V4uoMg-0600-1500-host-01:** [x] Y  [ ] N

**Catastrophic 2o0f-V4uoMg-0600-1500-host-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-K2DZ-03

**Gold window:** 15-27.8

**Critical unit:** 2o0f-V4uoMg-1500-2780-balance-01

**Emitted outputs overlapping the window:**

> [11-17] and you have to balance it appropriately so that you can get out of the hostages.
> [17-20] It has to be not too strong, but it has to be contagious.
> [20-24] That's why it's the golden ratio of the corona formula.
> [24-28] The contagious rate is determined according to the golden ratio.

**Meaning:** [x] Y  [ ] N

**Correct 2o0f-V4uoMg-1500-2780-balance-01:** [x] Y  [ ] N

**Catastrophic 2o0f-V4uoMg-1500-2780-balance-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-K2DZ-04

**Gold window:** 32.9-38.72

**Critical unit:** 2o0f-V4uoMg-3290-3872-paper-01

**Emitted outputs overlapping the window:**

> [28-33] Is there a genetic difference between Spanish and Italian scientists?
> [33-34] I think there is.
> [34-38] Recently, a Spanish and Italian scientist published a paper.
> [38-39] There is a genetic difference.

**Meaning:** [x] Y  [ ] N

**Correct 2o0f-V4uoMg-3290-3872-paper-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-3290-3872-paper-01:** [x] Y  [ ] N

**Note:**  
hackathon grade: pass

### PA-K2DZ-05

**Gold window:** 39.34-49.4

**Critical unit:** 2o0f-V4uoMg-3934-4940-evidence-01

**Emitted outputs overlapping the window:**

> [39-45] So, until then, no one was sure of the difference in human genes.
> [45-46] Because there is no data.
> [46-48] But recently, it came out like that.
> [48-50] We also studied it recently.

**Meaning:** [x] Y  [ ] N

**Correct 2o0f-V4uoMg-3934-4940-evidence-01:** [x] Y  [ ] N

**Catastrophic 2o0f-V4uoMg-3934-4940-evidence-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-K2DZ-06

**Gold window:** 49.66-60

**Critical unit:** 2o0f-V4uoMg-4966-6000-genome-01

**Emitted outputs overlapping the window:**

> [48-50] We also studied it recently.
> [50-55] We analyzed the genome of thousands of Koreans from the 10,000-person genome project in Ulsan.
> [55-60] The initial study showed that Koreans may be a little resistant to the coronavirus.

**Meaning:** [ ] Y  [x] N

**Correct 2o0f-V4uoMg-4966-6000-genome-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-4966-6000-genome-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

## Lane PA-T7XM

- Capture binding: sha256:daf46708ae1bb4f8ca582fc3f7e96d8d9010986c0947c87a07db7fcb2465cf7c (4665 bytes)
- Frozen clip: Ux-TMWnmntM
- Source media: public/demo/runs/run-006/clip.mp4
- Frozen gold: bench/packs/hard-ko-provider-authorized-v1/Ux-TMWnmntM.gold.json
- Decision items: 13

### PA-T7XM-01

**Gold window:** 0-1.55

**Critical unit:** Ux-TMWnmntM-0000-0155-meaning-01

**Emitted output overlapping the window:**

> [0-8] There are a few people I know who went to Thailand, and they said they really liked Thailand.

**Meaning:** [x] Y  [ ] N

**Correct Ux-TMWnmntM-0000-0155-meaning-01:** [x] Y  [ ] N

**Catastrophic Ux-TMWnmntM-0000-0155-meaning-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-T7XM-02

**Gold window:** 1.55-1.95

**Critical unit:** Ux-TMWnmntM-0155-0195-backchannel-01

**Emitted output overlapping the window:**

> [0-8] There are a few people I know who went to Thailand, and they said they really liked Thailand.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-0155-0195-backchannel-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-0155-0195-backchannel-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-T7XM-03

**Gold window:** 1.95-7.7

**Critical unit:** Ux-TMWnmntM-0195-0770-meaning-01

**Emitted output overlapping the window:**

> [0-8] There are a few people I know who went to Thailand, and they said they really liked Thailand.

**Meaning:** [x] Y  [ ] N

**Correct Ux-TMWnmntM-0195-0770-meaning-01:** [x] Y  [ ] N

**Catastrophic Ux-TMWnmntM-0195-0770-meaning-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-T7XM-04

**Gold window:** 11.9-12.35

**Critical unit:** Ux-TMWnmntM-1190-1235-backchannel-01

**Emitted outputs overlapping the window:**

> [11-12] Oh, really?
> [12-13] Yes.

**Meaning:** [x] Y  [ ] N

**Correct Ux-TMWnmntM-1190-1235-backchannel-01:** [x] Y  [ ] N

**Catastrophic Ux-TMWnmntM-1190-1235-backchannel-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-T7XM-05

**Gold window:** 12.7-13.6

**Critical unit:** Ux-TMWnmntM-1270-1360-question-01

**Emitted outputs overlapping the window:**

> [12-13] Yes.
> [13-14] Why?

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-1270-1360-question-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-1270-1360-question-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-T7XM-06

**Gold window:** 14-18.8

**Critical unit:** Ux-TMWnmntM-1400-1880-kinship-01

**Emitted output overlapping the window:**

> [14-25] My older sister and sister-in-law were going to live in Thailand for a month with my older brother-in-law.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-1400-1880-kinship-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-1400-1880-kinship-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-T7XM-07

**Gold window:** 18.8-19

**Critical unit:** Ux-TMWnmntM-1880-1900-backchannel-01

**Emitted output overlapping the window:**

> [14-25] My older sister and sister-in-law were going to live in Thailand for a month with my older brother-in-law.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-1880-1900-backchannel-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-1880-1900-backchannel-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-T7XM-08

**Gold window:** 19-19.15

**Critical unit:** Ux-TMWnmntM-1900-1915-kinship-01

**Emitted output overlapping the window:**

> [14-25] My older sister and sister-in-law were going to live in Thailand for a month with my older brother-in-law.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-1900-1915-kinship-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-1900-1915-kinship-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-T7XM-09

**Gold window:** 19.15-20.2

**Critical unit:** Ux-TMWnmntM-1915-2020-backchannel-01

**Emitted output overlapping the window:**

> [14-25] My older sister and sister-in-law were going to live in Thailand for a month with my older brother-in-law.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-1915-2020-backchannel-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-1915-2020-backchannel-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-T7XM-10

**Gold window:** 20.2-25.2

**Critical unit:** Ux-TMWnmntM-2020-2520-kinship-01

**Emitted outputs overlapping the window:**

> [14-25] My older sister and sister-in-law were going to live in Thailand for a month with my older brother-in-law.
> [25-32] My older brother-in-law was so busy that I was the only one left, so I lived in Thailand for a month for free.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-2020-2520-kinship-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-2020-2520-kinship-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-T7XM-11

**Gold window:** 25.52-28.12

**Critical unit:** Ux-TMWnmntM-2552-2812-busy-01

**Emitted output overlapping the window:**

> [25-32] My older brother-in-law was so busy that I was the only one left, so I lived in Thailand for a month for free.

**Meaning:** [x] Y  [ ] N

**Correct Ux-TMWnmntM-2552-2812-busy-01:** [x] Y  [ ] N

**Catastrophic Ux-TMWnmntM-2552-2812-busy-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-T7XM-12

**Gold window:** 28.12-28.32

**Critical unit:** Ux-TMWnmntM-2812-2832-backchannel-01

**Emitted output overlapping the window:**

> [25-32] My older brother-in-law was so busy that I was the only one left, so I lived in Thailand for a month for free.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-2812-2832-backchannel-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-2812-2832-backchannel-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-T7XM-13

**Gold window:** 28.32-39.87

**Critical unit:** Ux-TMWnmntM-2832-3987-meaning-01

**Emitted outputs overlapping the window:**

> [25-32] My older brother-in-law was so busy that I was the only one left, so I lived in Thailand for a month for free.
> [32-39] I lived in Chiang Mai for a month, and the neighborhood was so pretty and the people were so kind.

**Meaning:** [x] Y  [ ] N

**Correct Ux-TMWnmntM-2832-3987-meaning-01:** [x] Y  [ ] N

**Catastrophic Ux-TMWnmntM-2832-3987-meaning-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

## Lane PA-F4RC

- Capture binding: sha256:2a21a1bee6939ddea28eaae4de7d2425666e38736891ac417d089feb4f362055 (3127 bytes)
- Frozen clip: 2o0f-V4uoMg
- Source media: bench/packs/hard-ko-provider-authorized-v1/2o0f-V4uoMg.m4a
- Frozen gold: bench/packs/hard-ko-provider-authorized-v1/2o0f-V4uoMg.gold.json
- Decision items: 3

### PA-F4RC-01

**Gold window:** 0-6

**Critical unit:** 2o0f-V4uoMg-0000-0600-inverse-01

**Emitted output overlapping the window:**

> [0-28] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct 2o0f-V4uoMg-0000-0600-inverse-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-0000-0600-inverse-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

### PA-F4RC-02

**Gold window:** 6-15

**Critical unit:** 2o0f-V4uoMg-0600-1500-host-01

**Emitted output overlapping the window:**

> [0-28] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct 2o0f-V4uoMg-0600-1500-host-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-0600-1500-host-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

### PA-F4RC-03

**Gold window:** 15-27.8

**Critical unit:** 2o0f-V4uoMg-1500-2780-balance-01

**Emitted output overlapping the window:**

> [0-28] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct 2o0f-V4uoMg-1500-2780-balance-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-1500-2780-balance-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

## Lane PA-N8K3

- Capture binding: sha256:fe4ea39c76dc1dec9f9fefa052576fbd0d4a6f5629036616edbfdedb6d1b1207 (5359 bytes)
- Frozen clip: Ni5rBtowdnI
- Source media: bench/packs/hard-ko-provider-authorized-v1/Ni5rBtowdnI.m4a
- Frozen gold: bench/packs/hard-ko-provider-authorized-v1/Ni5rBtowdnI.gold.json
- Decision items: 4

### PA-N8K3-01

**Gold window:** 0-9.3

**Critical unit:** Ni5rBtowdnI-0000-0930-identity-01

**Emitted outputs overlapping the window:**

> [0-4] My name is Kim Ki-hyun, and I'm a dancer.
> [4-8] My name is Kim Ki-hyun, and I'm a dancer.
> [8-12] My name is Kim Ki-hyun, and I'm a dancer.

**Meaning:** [ ] Y  [x] N

**Correct Ni5rBtowdnI-0000-0930-identity-01:** [ ] Y  [x] N

**Catastrophic Ni5rBtowdnI-0000-0930-identity-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-N8K3-02

**Gold window:** 9.3-23

**Critical unit:** Ni5rBtowdnI-0930-2300-waacking-01

**Emitted outputs overlapping the window:**

> [8-12] My name is Kim Ki-hyun, and I'm a dancer.
> [12-16] My name is Kim Ki-hyun, and I'm a dancer.
> [16-20] My name is Kim Ki-hyun, and I'm a dancer.
> [20-24] My name is Kim Ki-hyun, and I'm a dancer.

**Meaning:** [ ] Y  [x] N

**Correct Ni5rBtowdnI-0930-2300-waacking-01:** [ ] Y  [x] N

**Catastrophic Ni5rBtowdnI-0930-2300-waacking-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-N8K3-03

**Gold window:** 23-31

**Critical unit:** Ni5rBtowdnI-2300-3100-drag-01

**Emitted outputs overlapping the window:**

> [20-24] My name is Kim Ki-hyun, and I'm a dancer.
> [24-28] My name is Kim Ki-hyun, and I'm a dancer.
> [28-32] My name is Kim Ki-hyun, and I'm a dancer.

**Meaning:** [ ] Y  [x] N

**Correct Ni5rBtowdnI-2300-3100-drag-01:** [ ] Y  [x] N

**Catastrophic Ni5rBtowdnI-2300-3100-drag-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-N8K3-04

**Gold window:** 31-45

**Critical unit:** Ni5rBtowdnI-3100-4500-persona-01

**Emitted outputs overlapping the window:**

> [28-32] My name is Kim Ki-hyun, and I'm a dancer.
> [32-36] My name is Kim Ki-hyun, and I'm a dancer.
> [36-40] My name is Kim Ki-hyun, and I'm a dancer.
> [40-44] My name is Kim Ki-hyun, and I'm a dancer.

**Meaning:** [ ] Y  [x] N

**Correct Ni5rBtowdnI-3100-4500-persona-01:** [ ] Y  [x] N

**Catastrophic Ni5rBtowdnI-3100-4500-persona-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

## Lane PA-W6PJ

- Capture binding: sha256:916bffca2018594c785fdb914f52f658c8a18ff8d0e1bed3abf03a7cf4556123 (4665 bytes)
- Frozen clip: Ux-TMWnmntM
- Source media: public/demo/runs/run-006/clip.mp4
- Frozen gold: bench/packs/hard-ko-provider-authorized-v1/Ux-TMWnmntM.gold.json
- Decision items: 13

### PA-W6PJ-01

**Gold window:** 0-1.55

**Critical unit:** Ux-TMWnmntM-0000-0155-meaning-01

**Emitted output overlapping the window:**

> [0-8] There are a few people I know who went to Thailand, and they said they really liked Thailand.

**Meaning:** [x] Y  [ ] N

**Correct Ux-TMWnmntM-0000-0155-meaning-01:** [x] Y  [ ] N

**Catastrophic Ux-TMWnmntM-0000-0155-meaning-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-W6PJ-02

**Gold window:** 1.55-1.95

**Critical unit:** Ux-TMWnmntM-0155-0195-backchannel-01

**Emitted output overlapping the window:**

> [0-8] There are a few people I know who went to Thailand, and they said they really liked Thailand.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-0155-0195-backchannel-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-0155-0195-backchannel-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-W6PJ-03

**Gold window:** 1.95-7.7

**Critical unit:** Ux-TMWnmntM-0195-0770-meaning-01

**Emitted output overlapping the window:**

> [0-8] There are a few people I know who went to Thailand, and they said they really liked Thailand.

**Meaning:** [x] Y  [ ] N

**Correct Ux-TMWnmntM-0195-0770-meaning-01:** [x] Y  [ ] N

**Catastrophic Ux-TMWnmntM-0195-0770-meaning-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-W6PJ-04

**Gold window:** 11.9-12.35

**Critical unit:** Ux-TMWnmntM-1190-1235-backchannel-01

**Emitted outputs overlapping the window:**

> [11-12] Oh, really?
> [12-13] Yes.

**Meaning:** [x] Y  [ ] N

**Correct Ux-TMWnmntM-1190-1235-backchannel-01:** [x] Y  [ ] N

**Catastrophic Ux-TMWnmntM-1190-1235-backchannel-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-W6PJ-05

**Gold window:** 12.7-13.6

**Critical unit:** Ux-TMWnmntM-1270-1360-question-01

**Emitted outputs overlapping the window:**

> [12-13] Yes.
> [13-14] Why?

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-1270-1360-question-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-1270-1360-question-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-W6PJ-06

**Gold window:** 14-18.8

**Critical unit:** Ux-TMWnmntM-1400-1880-kinship-01

**Emitted output overlapping the window:**

> [14-25] My older sister and sister-in-law were going to live in Thailand for a month with my older brother-in-law.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-1400-1880-kinship-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-1400-1880-kinship-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-W6PJ-07

**Gold window:** 18.8-19

**Critical unit:** Ux-TMWnmntM-1880-1900-backchannel-01

**Emitted output overlapping the window:**

> [14-25] My older sister and sister-in-law were going to live in Thailand for a month with my older brother-in-law.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-1880-1900-backchannel-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-1880-1900-backchannel-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-W6PJ-08

**Gold window:** 19-19.15

**Critical unit:** Ux-TMWnmntM-1900-1915-kinship-01

**Emitted output overlapping the window:**

> [14-25] My older sister and sister-in-law were going to live in Thailand for a month with my older brother-in-law.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-1900-1915-kinship-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-1900-1915-kinship-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-W6PJ-09

**Gold window:** 19.15-20.2

**Critical unit:** Ux-TMWnmntM-1915-2020-backchannel-01

**Emitted output overlapping the window:**

> [14-25] My older sister and sister-in-law were going to live in Thailand for a month with my older brother-in-law.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-1915-2020-backchannel-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-1915-2020-backchannel-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-W6PJ-10

**Gold window:** 20.2-25.2

**Critical unit:** Ux-TMWnmntM-2020-2520-kinship-01

**Emitted outputs overlapping the window:**

> [14-25] My older sister and sister-in-law were going to live in Thailand for a month with my older brother-in-law.
> [25-32] My older brother-in-law was so busy that I was the only one left, so I lived in Thailand for a month for free.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-2020-2520-kinship-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-2020-2520-kinship-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-W6PJ-11

**Gold window:** 25.52-28.12

**Critical unit:** Ux-TMWnmntM-2552-2812-busy-01

**Emitted output overlapping the window:**

> [25-32] My older brother-in-law was so busy that I was the only one left, so I lived in Thailand for a month for free.

**Meaning:** [x] Y  [ ] N

**Correct Ux-TMWnmntM-2552-2812-busy-01:** [x] Y  [ ] N

**Catastrophic Ux-TMWnmntM-2552-2812-busy-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

### PA-W6PJ-12

**Gold window:** 28.12-28.32

**Critical unit:** Ux-TMWnmntM-2812-2832-backchannel-01

**Emitted output overlapping the window:**

> [25-32] My older brother-in-law was so busy that I was the only one left, so I lived in Thailand for a month for free.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-2812-2832-backchannel-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-2812-2832-backchannel-01:** [ ] Y  [x] N

**Note:**  
hackathon grade

### PA-W6PJ-13

**Gold window:** 28.32-39.87

**Critical unit:** Ux-TMWnmntM-2832-3987-meaning-01

**Emitted outputs overlapping the window:**

> [25-32] My older brother-in-law was so busy that I was the only one left, so I lived in Thailand for a month for free.
> [32-39] I lived in Chiang Mai for a month, and the neighborhood was so pretty and the people were so kind.

**Meaning:** [x] Y  [ ] N

**Correct Ux-TMWnmntM-2832-3987-meaning-01:** [x] Y  [ ] N

**Catastrophic Ux-TMWnmntM-2832-3987-meaning-01:** [ ] Y  [x] N

**Note:**  
hackathon grade: pass

## Lane PA-D9VH

- Capture binding: sha256:c47245fb642d90722c591b40c220d2589575ee9a4fdc736ff98bc84040c2f759 (3127 bytes)
- Frozen clip: 2o0f-V4uoMg
- Source media: bench/packs/hard-ko-provider-authorized-v1/2o0f-V4uoMg.m4a
- Frozen gold: bench/packs/hard-ko-provider-authorized-v1/2o0f-V4uoMg.gold.json
- Decision items: 3

### PA-D9VH-01

**Gold window:** 0-6

**Critical unit:** 2o0f-V4uoMg-0000-0600-inverse-01

**Emitted output overlapping the window:**

> [0-28] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct 2o0f-V4uoMg-0000-0600-inverse-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-0000-0600-inverse-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

### PA-D9VH-02

**Gold window:** 6-15

**Critical unit:** 2o0f-V4uoMg-0600-1500-host-01

**Emitted output overlapping the window:**

> [0-28] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct 2o0f-V4uoMg-0600-1500-host-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-0600-1500-host-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

### PA-D9VH-03

**Gold window:** 15-27.8

**Critical unit:** 2o0f-V4uoMg-1500-2780-balance-01

**Emitted output overlapping the window:**

> [0-28] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct 2o0f-V4uoMg-1500-2780-balance-01:** [ ] Y  [x] N

**Catastrophic 2o0f-V4uoMg-1500-2780-balance-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

## Lane PA-B5QG

- Capture binding: sha256:9d9c75e7b5c13e1a47c0aa79d98954719ae689625108dc3019f66c24fc9c7d84 (3123 bytes)
- Frozen clip: Ux-TMWnmntM
- Source media: public/demo/runs/run-006/clip.mp4
- Frozen gold: bench/packs/hard-ko-provider-authorized-v1/Ux-TMWnmntM.gold.json
- Decision items: 4

### PA-B5QG-01

**Gold window:** 0-1.55

**Critical unit:** Ux-TMWnmntM-0000-0155-meaning-01

**Emitted output overlapping the window:**

> [0-7] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-0000-0155-meaning-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-0000-0155-meaning-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

### PA-B5QG-02

**Gold window:** 1.55-1.95

**Critical unit:** Ux-TMWnmntM-0155-0195-backchannel-01

**Emitted output overlapping the window:**

> [0-7] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-0155-0195-backchannel-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-0155-0195-backchannel-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

### PA-B5QG-03

**Gold window:** 1.95-7.7

**Critical unit:** Ux-TMWnmntM-0195-0770-meaning-01

**Emitted output overlapping the window:**

> [0-7] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-0195-0770-meaning-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-0195-0770-meaning-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

### PA-B5QG-04

**Gold window:** 28.32-39.87

**Critical unit:** Ux-TMWnmntM-2832-3987-meaning-01

**Emitted output overlapping the window:**

> [30-40] Translate a family relationship only when surrounding speech supplies explicit kinship evidence, including terms such as 친누나 or 매형.

**Meaning:** [ ] Y  [x] N

**Correct Ux-TMWnmntM-2832-3987-meaning-01:** [ ] Y  [x] N

**Catastrophic Ux-TMWnmntM-2832-3987-meaning-01:** [x] Y  [ ] N

**Note:**  
rule-prompt dump / non-translation

## Reconciliation header

Complete this only after at least two distinct reviewers have independently locked every item.

- Reviewer 1 name and git identity: ______________________________
- Reviewer 2 name and git identity: ______________________________
- Additional reviewer name and git identity, if any: _____________
- All named reviewers remained blinded until decisions were locked: [ ] Yes  [ ] No
- Every disagreement was reconciled without changing frozen gold: [ ] Yes  [ ] No
- Reconciliation notes: __________________________________________

Do not create studio.bench.output-labels.v1 JSON until the identities, blindness attestation,
and all 90 semantic decisions are complete. The final receipts must use the local lane map to bind
each decision set to its exact run and capture path. The receipt id must be derived only after the
human-completed bytes exist.
