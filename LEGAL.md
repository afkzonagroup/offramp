# Legal basis and interpretation

Offramp implements parts of Chapter VI ("Switching between data processing
services") of **Regulation (EU) 2023/2854** of the European Parliament and of
the Council of 13 December 2023 on harmonised rules on fair access to and use
of data (Data Act), OJ L, 2023/2854, 22.12.2023.

- Official text (English): <https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854>
- ELI: <http://data.europa.eu/eli/reg/2023/2854/oj>

Every value in the code comes from that text (`src/legal/refs.ts`). Quotations
below are from the official English version. This document explains what
Offramp does with each provision and where it had to choose a reading. It is
not legal advice.

## Dates

| Date | Source | Use in Offramp |
|---|---|---|
| 11 January 2024 | Art. 50, first paragraph: entry into force "on the twentieth day following that of its publication" (published 22.12.2023); Art. 29(2) | Start of the reduced-charges window named in Art. 29(2) |
| 12 September 2025 | Art. 50: "It shall apply from 12 September 2025." Art. 50 sets no later date for Chapter VI | Requests made earlier are flagged `before-application` |
| 12 January 2027 | Art. 29(1): "From 12 January 2027, providers of data processing services shall not impose any switching charges on the customer for the switching process." | Switching charges on or after this day are conflicts |

## Definitions (Art. 2)

| Point | Term | How Offramp uses it |
|---|---|---|
| (8) | data processing service | The services in a provider profile |
| (9) | same service type: "share the same primary objective, data processing service model and main functionalities" | `serviceType` description; flagged when missing (info) |
| (30) | customer | The customer of a switching request |
| (32) | digital assets: "elements in digital form, including applications, for which the customer has the right of use, independently from the contractual relationship" | `digitalAssets` with kinds from recital 83 (applications, configuration, access rights, virtual machines, containers) |
| (33) | on-premises ICT infrastructure | Target `on-premises` |
| (34) | switching | The switching request and its lifecycle |
| (35) | data egress charges | Charge kind `data-egress`, a switching charge |
| (36) | switching charges: "charges, other than standard service fees or early termination penalties, ... including data egress charges" | Charge kinds `switching` and `data-egress`; `standard-service-fee` and `early-termination-penalty` are not switching charges |
| (37) | functional equivalence | Art. 30(1) checks for IaaS services |
| (38) | exportable data: "the input and output data, including metadata, directly or indirectly generated, or cogenerated, by the customer's use of the data processing service, excluding any assets or data protected by intellectual property rights, or constituting a trade secret, of providers ... or third parties" | `exportableData` categories with origin `input`, `output`, `metadata` or `mixed` |

## Article map

| Provision | What it requires | Offramp | Code |
|---|---|---|---|
| Art. 23 | Remove obstacles to switching; points (a) to (e) | (c) free-tier note; (e) unbundling question for IaaS | `rules/contract.ts` |
| Art. 24 | Obligations apply to the source provider's own services | Scope note in README | — |
| Art. 25(1) | Written contract, available before signing, storable and reproducible | Three checks | `rules/contract.ts` |
| Art. 25(2)(a) | Switch or port "without undue delay and in any event not after the mandatory maximum transitional period of 30 calendar days, to be initiated after the maximum notice period"; duties (i) to (iv) during it | 30-day transitional period in the timeline; four duty checks; duties listed in notices | `engine/timeline.ts`, `rules/contract.ts`, `docs/generate.ts` |
| Art. 25(2)(b) | Support for the customer's exit strategy | Check | `rules/contract.ts` |
| Art. 25(2)(c) | Contract terminated and customer notified (i) on successful completion, (ii) at the end of the maximum notice period when the customer chooses erasure | Termination milestones; completion notice | `engine/timeline.ts`, `docs/generate.ts` |
| Art. 25(2)(d) | "a maximum notice period for initiation of the switching process, which shall not exceed two months" | Notice period in the timeline, capped at two months; contract check in days and months | `engine/timeline.ts`, `rules/contract.ts` |
| Art. 25(2)(e) | "an exhaustive specification of all categories of data and digital assets that can be ported ... including, at a minimum, all exportable data" | Data categories and digital assets in the profile; default choice in a request is all of them | `model/profile.ts`, `engine/lifecycle.ts` |
| Art. 25(2)(f) | Exhaustive specification of categories exempted "where a risk of breach of trade secrets of the provider exists", not impeding or delaying switching | Exempted categories need `tradeSecretRisk: true`; they cannot be chosen in a request | `rules/contract.ts`, `model/parse-request.ts` |
| Art. 25(2)(g) | "a minimum period for data retrieval of at least 30 calendar days, starting after the termination of the transitional period" | Retrieval period in the timeline, at least 30 days | `engine/timeline.ts` |
| Art. 25(2)(h) | Full erasure "after the expiry of the retrieval period ... or after the expiry of an alternative agreed period at a date later than" it, "provided that the switching process has been completed successfully" | Erasure date; erasure confirmation requires recorded completion; early erasure flagged | `engine/timeline.ts`, `engine/lifecycle.ts` |
| Art. 25(2)(i) | Switching charges in accordance with Art. 29 | Check | `rules/contract.ts` |
| Art. 25(3) | Customer notifies a switch to a different provider (with its details), to on-premises, or erasure | Request targets `provider` (name required), `on-premises`, `erase` | `model/request.ts` |
| Art. 25(4) | Where 30 days are technically unfeasible, the provider notifies "within 14 working days of the making of the switching request", justifies it and indicates "an alternative transitional period, which shall not exceed seven months"; service continuity ensured | Working-day deadline; alternative period capped at seven months; late notice flagged; notice document | `engine/timeline.ts`, `engine/lifecycle.ts`, `docs/generate.ts` |
| Art. 25(5) | Customer may "extend the transitional period once for a period that the customer considers more appropriate" | One extension, no statutory maximum | `engine/timeline.ts`, `engine/lifecycle.ts` |
| Art. 26(a) | Information on switching and porting procedures, methods, formats, known restrictions and technical limitations | Checks and information pack | `rules/contract.ts`, `docs/generate.ts` |
| Art. 26(b) | Reference to an up-to-date online register of data structures, formats, standards and open interoperability specifications | Register URL and coverage checks | `rules/contract.ts` |
| Art. 27 | Good faith of all parties | Stated in the switching plan | `docs/generate.ts` |
| Art. 28(1) | Website information on the jurisdiction of the ICT infrastructure and on measures against unlawful international governmental access | Jurisdiction and page checks | `rules/contract.ts` |
| Art. 28(2) | Those websites listed in contracts | Check | `rules/contract.ts` |
| Art. 29(1) | No switching charges from 12 January 2027 | Conflicts for schedule items and imposed charges | `rules/charges.ts` |
| Art. 29(2), (3) | Reduced switching charges until then, not exceeding "the costs incurred by the provider ... that are directly linked to the switching process concerned" | Compared with the cost the provider states; never judged | `rules/charges.ts` |
| Art. 29(4) | Pre-contract information on standard fees, early termination penalties and reduced switching charges | Checks | `rules/contract.ts` |
| Art. 29(5), (6) | Information on highly complex or costly switching; public availability | Note and check | `rules/contract.ts` |
| Art. 30(1) | Infrastructure services: reasonable measures for functional equivalence; capabilities, information, documentation, technical support and, where appropriate, tools | Checks for `iaas` services | `rules/contract.ts` |
| Art. 30(2) | Other services: open interfaces, to an equal extent, free of charge | Interface checks for non-IaaS services | `rules/contract.ts` |
| Art. 30(3), (4) | Compatibility with common specifications or harmonised standards 12 months after publication of their references; register updates | Note only (publication is not tracked) | `rules/contract.ts` |
| Art. 30(5) | Without published specifications, export "in a structured, commonly used and machine-readable format" | Format check per data category | `rules/contract.ts` |
| Art. 30(6) | No duty to develop new technology or disclose protected assets | Reflected in the trade-secret exemption | — |
| Art. 31(1) | Custom-built services not offered at broad commercial scale: Art. 23(d), Art. 29, Art. 30(1) and (3) do not apply | Regime `custom-built`; those checks skipped; flagged if offered at scale | `rules/contract.ts`, `rules/charges.ts` |
| Art. 31(2) | Non-production versions for testing and evaluation, for a limited period: Chapter VI does not apply | Regime `non-production`; checks skipped | `rules/contract.ts` |
| Art. 31(3) | Inform prospective customers of the obligations that do not apply | Check | `rules/contract.ts` |
| Art. 34(1) | Some switching rules apply to in-parallel use | Not modelled beyond egress charges |  — |
| Art. 34(2) | Egress charges for in-parallel use only to pass on costs incurred | Charge kind `parallel-use-egress`, compared with stated costs at any date | `rules/charges.ts` |
| Art. 50 | Application dates | See Dates | `legal/refs.ts` |

Recitals are cited only where they explain the articles: 81 (delivery
models), 83 (digital assets), 85 (switching steps), 86 (functional
equivalence for IaaS only), 87 (extension, burden of proof, timing of the
customer's extension), 88 and 89 (switching charges, additional services,
standard fees), 95 (information content), 98 (custom-built services), 99
(in-parallel use). Recitals are not binding on their own; findings based only
on a recital are of severity `review`.

## Interpretation choices

The Data Act leaves the following points open. Offramp makes each choice
explicit, and every timeline lists its assumptions.

1. **Counting periods.** The Data Act does not say how periods are counted,
   and does not refer to Regulation (EEC, Euratom) No 1182/71 on periods,
   dates and time limits. Offramp therefore does not claim to apply that
   Regulation. It uses this reading: a period that runs from an event does
   not count the day of the event; it starts on the next day and ends at the
   end of its last day (midnight) in the provider profile's time zone. Unlike
   Art. 3(4) of Regulation 1182/71, a period whose last day is a Saturday,
   Sunday or public holiday is not extended to the next working day. For the
   provider's deadlines (notification, end of the transitional period) this
   gives the earlier, stricter date. For the retrieval period it gives the
   earliest erasure date; a provider that wants to stay clear of the other
   reading waits until the next working day before erasing.
2. **Months.** "Two months" and "seven months" end on the day with the same
   number in the last month; when that month is shorter, on its last day
   (a request made on 31 December has a notice period ending on 28 or 29
   February).
3. **Calendar days.** "30 calendar days" are counted as 30 consecutive days,
   weekends and holidays included.
4. **Working days.** The Data Act does not define "working days" or say
   whose public holidays count. Offramp counts Monday to Friday, minus the
   public holidays listed in the profile (`workingDays.publicHolidays`).
   With no list, no holidays are excluded, which gives the earliest possible
   deadline, the safer reading for the provider who must notify. Which
   holiday calendar applies (the provider's establishment, the governing law
   of the contract) is for the parties to decide; the profile names it.
5. **Time zone.** Calendar days are counted in the IANA time zone of the
   profile. A request made at 23:30 UTC on 30 October counts as made on
   31 October in Vilnius. Day boundaries follow the real offsets, so a
   period ending on a day of a daylight-saving change ends at that day's
   local midnight (a 23- or 25-hour day).
6. **Start of the transitional period.** Art. 25(2)(a) says the transitional
   period is "to be initiated after the maximum notice period". Offramp
   starts it on the day after the notice period ends, or on a start date
   the parties agreed (`transitionStartDate`). A later agreed start is
   flagged for a record of the customer's choice.
7. **Notice periods in days.** Two months span 59 to 62 days. A contract
   notice period of up to 59 days never exceeds two months; 60 to 62 days
   exceed it for requests on some days of the year (flagged for review);
   63 days or more always do (conflict). In a timeline, a contract notice
   period longer than two months is replaced by the two-month maximum.
8. **Seven months.** The alternative transitional period of Art. 25(4) is
   measured from the same point as the 30 days: the end of the notice
   period (or the day before an agreed start).
9. **Late unfeasibility notice.** Art. 25(4) requires the notice "within 14
   working days of the making of the switching request", and recital 87 puts
   the burden of proof "fully on the provider". A provider that notified late
   cannot rely on the alternative period. Offramp flags the late notice as a
   conflict and keeps the standard end of the transitional period as the
   provider's deadline: a switch completed after it is "late", never "done",
   and an unfinished switch is "overdue". The customer was told of the later
   end and may have planned around it, so the retrieval period starts after
   the later of the two ends (`disregardedLastDay`) and the customer loses no
   retrieval time. This reading is conservative for the customer on both
   points.
10. **Customer extension.** Art. 25(5) sets no maximum; Offramp sets none.
    The extension can follow a provider's alternative period (Art. 25(5):
    "Without prejudice to paragraph 4"). Art. 25(5) extends "the transitional
    period", and recital 87 says the customer may use the right "prior to or
    during the transitional period", so a period that has ended cannot be
    extended. Recording such an extension is refused. In a file that already
    contains one, Offramp flags it as a conflict and keeps the original end
    as the deadline; the retrieval period starts after the end the customer
    named, as in choice 9. It is flagged rather than refused at validation
    because whether it is late depends on the provider profile (notice and
    transitional periods), which plain request validation does not see, and
    because refusing the file would hide what the parties actually recorded.
11. **Retrieval period after early completion.** The retrieval period starts
    "after the termination of the transitional period that was agreed".
    Offramp anchors it on the end of the agreed transitional period
    (including extensions), even when switching completes earlier. This
    never gives an earlier erasure date than the alternative reading.
12. **Erase-only requests.** When the customer chooses erasure
    (Art. 25(3)(c)), the contract ends at the end of the notice period
    (Art. 25(2)(c)(ii)). The Regulation sets no retrieval period for this
    case; Offramp shows erasure from the next day.
13. **12 January 2027.** Art. 29(2) allows reduced charges "From 11 January
    2024 to 12 January 2027" and Art. 29(1) prohibits them "From 12 January
    2027". Offramp resolves the overlap on 12 January 2027 for the
    prohibition. The day is the calendar day on which the charge is imposed,
    in the profile's time zone.
14. **Reduced charges before 12 September 2025.** Art. 29(2) names
    11 January 2024, but the Regulation applies from 12 September 2025
    (Art. 50). Charges imposed earlier are reported as before application.
15. **Directly linked costs.** Offramp compares a charge with the cost the
    provider states and asks how that cost was established. It never decides
    whether a cost is directly linked to switching.
16. **Additional services.** Recital 89 allows charging for services beyond
    the switching obligations performed at the customer's request at a
    price agreed in advance. Offramp asks for both facts (severity `review`).
17. **Standard service fees.** The contract "remains applicable" during the
    transitional period (Art. 25(2)(a)) and ends when switching is completed
    (Art. 25(2)(c)(i)) or, for erasure, at the end of the notice period
    (Art. 25(2)(c)(ii)); recital 89 keeps standard fees "until the contract
    for the provision of the relevant services ceases to apply". Fees imposed
    after the earlier of completion and the end of the transitional period
    (or after the notice period for erasure) are flagged for review, not as a
    conflict, because an invoice can cover an earlier period.
18. **Specific regimes.** Whether a service is custom-built (Art. 31(1)) or a
    non-production version (Art. 31(2)) is the provider's statement in the
    profile; Offramp checks only that the stated facts fit the conditions.

## What Offramp does not cover

- Chapters II to V and VII to XI of the Data Act (connected products, data
  sharing, unfair terms, public sector access, international governmental
  access under Art. 32, interoperability of data spaces, smart contracts).
- The in-parallel use rules of Art. 34(1) beyond egress charges.
- Whether a service is a "data processing service", which services share the
  "same service type", and whether functional equivalence is achieved.
- Common specifications and harmonised standards under Art. 30(3) and
  Art. 35; their publication is not tracked.
- National implementing rules, penalties (Art. 40) and competent
  authorities.
- Directive (EU) 2019/770, Regulation (EU) 2016/679 and other law that may
  apply to the same contract.

## Translations

All texts are written in English by Offramp. They are not official texts.
No translations are included. Any translation added later must be marked as
`source: "translation"` and reviewed by a native speaker; translations are
never presented as official.
