# UPSED Voltronic Protocol Catalog (clean-room)

## Response layouts (P-series, Protocol 01)

Tokens are space-separated after the leading `(`. Samples are live captures
from a Protocol 01 unit; each layout was also checked against disassembly.
Implemented in `src-tauri/src/protocol/p_series.rs`.

| Query | Layout | Live sample |
|---|---|---|
| `QGS` | in V, in Hz, out V, out Hz, out A, load %, bus+ V, bus- V, battery V, token 9 (unidentified, `---.-`), temp C, 12-char status bits (meaning not decoded) | `(230.2 49.9 229.5 49.9 000.8 020 370.4 373.5 027.1 ---.- 031.8 100000000001` |
| `QBV` | battery V, batteries in series, parallel groups, capacity %, remaining min | `(027.1 02 01 095 037` |
| `QBYV` | bypass high V, low V | `(264 180` |
| `QBYF` | bypass high Hz, low Hz | `(53.0 47.0` |
| `QHE` | ECO high V, low V | `(242 218` |
| `QRI` | rated out V, rated out A, battery nominal V, rated Hz | `(230.0 004 024.0 50.0` |
| `QMD` | `#`-padded model, `#`-padded VA, power factor %, phases, in V, out V, batteries in series, V per battery | `(#######WPHVT1K0 ###1000 90 1/1 230 230 02 12.0` |
| `QFLAG` | `E` + enabled letters + `D` + disabled letters | `(EpbrsghczDoavefm` |
| `QMOD` | one letter: P PowerOn, S Standby, Y Bypass, L Line, B Battery, T Test, F Fault, E ECO, C Converter, D Shutdown | `(L` |
| `QWS` | 64-char 0/1 warning string | `(000...0` |
| `QFS` | `(OK` when no fault; otherwise fault payload (layout not extracted) | not observed |
| `QSK1`/`QSK2` | `1`/`0`; units without switchable outlets answer `(NAK` | `(NAK` |
| `QBTAH` | layout not extracted | not observed |

Cross-checks used: `QBV` battery V equals `QGS` token 8; `QMD` series count
times per-battery V equals `QRI` nominal battery V.


Independent description of the serial/HID command vocabulary observed on
Voltronic-family UPS units, compiled for interoperability under
17 U.S.C. § 1201(f) and EU Directive 2009/24/EC Art. 6. It lists wire
mnemonics and argument layouts only. No vendor code, resources or
binaries are reproduced.

Conventions: every frame is the ASCII command followed by `\r`. A
successful write is answered `(ACK\r`; a rejected one `(NAK\r`.
Processor families: `P00`, `P01`, `P02`, `P03`, `P05`, `P08`, `P09`, `P10`,
`P13`, `P14`, `P31`, `P33`, `P35`, `P39`, `P44`, `P45`, `P71`, `P73`,
`P74`, `P99` (plus `PMV*`, `P98`, `Taurus`, which are out of scope).

Status column: **V** = argument layout verified by disassembly,
**M** = mnemonic observed only (layout/response not yet extracted),
**U** = in UPSED today but not observed in any P-series family.

## T1 Read-only queries

| Command | Meaning | Families | Status |
|---|---|---|---|
| `QGS` | General status (voltages, load, battery) | P00 P01 P02 P03 P05 P08 P09 P10 P13 P14 P31 P71 P73 P74 P99 | M |
| `QMOD` | Working mode letter `P S Y L B T F E C D` | all above | M |
| `QWS` | Warning/fault bit string | all above | M |
| `QRI` | Rating information | all above | M |
| `QBV` | Battery voltage/capacity block | most | M |
| `QMD` | Model descriptor | all above | M |
| `QFS` | Fault status | all above | M |
| `QFLAG` | Capability/enable flags | all above | M |
| `QID` | Device id / serial | P00 P01 P02 P05 P09 P31 P33 P39 P44 P73 P74 | M |
| `QVFW` | Firmware version | most | M |
| `QHE` | High-efficiency (ECO) window | P01 P03 P05 P09 P10 P13 P14 P33 P39 P44 P73 P74 P99 | M |
| `QBYV` / `QBYF` | Bypass voltage / frequency limits | P01 P02 P03 P05 P09 P10 P13 P14 P33 P39 P44 P73 P74 P99 | M |
| `QBTAH` | Battery capacity (Ah) | P00 P01 P05 P33 P39 P44 P73 P74 | M |
| `QSK1` / `QSK2` | Outlet-group states | P00 P01 P02 P03 P05 P10 P13 P14 P73 P74 P99 | M |
| `QMF` / `QMUD` | Manufacturer / model UID | P01 P73 P74 | M |

Legacy Megatec/Axpert queries already implemented (`QPI`, `Q1`, `QS`,
`QPIGS`, `QPIWS`, `QPIRI`) are **not** used by any P-series family above.

## T2 Non-destructive

| Command | Meaning | Families | Status |
|---|---|---|---|
| `BZON` / `BZOFF` | Buzzer enable / mute | P00 P01 P02 P03 P08 P09 P10 P13 P14 P31 P33 P44 P73 P74 P99 | V (code) - **answers `(NAK` on the tested P01 unit; the vendor UI never sends it. Use `PEA`/`PDA`, T3.** |
| `T` | 10 s battery test | most | V |
| `T<mm>` | Timed battery test, minutes | most | V |
| `TL` | Test until battery low | most | V |
| `CT` | Cancel test | P35 P45 P71 and base class | V |

## T3 Configuration writes (persistent)

Layouts verified from the base processor; all answer `(ACK` on success.

| Command | Meaning | Argument layout | Status |
|---|---|---|---|
| `PHV<vvv>` | Bypass high voltage | integer, zero-padded to 3 digits | V |
| `PLV<vvv>` | Bypass low voltage | integer, zero-padded to 3 digits | V |
| `PGF<f>` | Bypass high frequency | decimal float, e.g. `53.0` | V |
| `PSF<f>` | Bypass low frequency | decimal float | V |
| `HEH<n>` / `HEL<n>` | ECO window high / low | plain integer | V |
| `MD<nnnn>` | Max battery backup time | integer, zero-padded to 4 digits | V |
| `PE<X>` / `PD<X>` | Enable / disable capability flag `X` (uppercase letter in the command; `QFLAG` reports it in lowercase) | `A` audible alarm, `P` bypass-mode alarm, `B` battery-mode alarm, `R` auto-restart, `O` bypass when UPS off, `V` converter mode, `E` high-efficiency (ECO) mode. Live log: `PDA`, `PEB`, `PEG` -> `(ACK`; `PEL`/`PDL` -> `(NAK` (unsupported) | V |
| `PF` | Restore factory defaults | none | V |
| `BATGN<n>` | Battery group count | integer | M |
| `BATTAH<nnnn>` | Battery capacity (Ah) | integer, 4 digits | M |
| `PPD<s>` | Power-on delay | string | M |
| `FREH<f>` / `FREL<f>` | Output frequency limits | decimal float | M |
| `W0E` | Battery-low related setting | none | M |

## T4 Power control

| Command | Meaning | Argument layout | Status |
|---|---|---|---|
| `S<mm>` / `S.<n>` | Shutdown after delay | `<1` min: `.N`; `<10`: `0N`; else `NN` | V |
| `S<mm>R<mmmm>` | Shutdown and restore | delay as above, then `R`, 4 digits | V |
| `CS` | Cancel shutdown | none | V |
| `SON` / `SOFF` | Output on / off | none | V |
| `SKON<n>` / `SKOFF<n>` | Outlet group on / off | group number | M |
| `BYP1` / `BYP0` | Force / release bypass | none | M |

## Mismatches against current UPSED commands

| UPSED today | Observed P-series equivalent |
|---|---|
| `PBVH<vvv>` / `PBVL<vvv>` (**U**) | `PHV<vvv>` / `PLV<vvv>` |
| `OLON<g>,<d>` / `OLOFF<g>,<d>` (**U**) | `SKON<g>` / `SKOFF<g>` |
| `MCHGC<nnnn>` (**U**) | none in P00-P14; `MNCHGC` / `MCHGMC` appear only in P71 / P73 |
| `PSDV<v>` (**U**) | none; battery-low handled by `W0E`, `BATTAH` |
