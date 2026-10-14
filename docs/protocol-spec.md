# UPSED Voltronic Protocol Catalog (clean-room)

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
| `BZON` / `BZOFF` | Buzzer enable / mute | P00 P01 P02 P03 P08 P09 P10 P13 P14 P31 P33 P44 P73 P74 P99 | V |
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
| `PE<x>` / `PD<x>` | Enable / disable capability flag `x` | one flag letter | V |
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
