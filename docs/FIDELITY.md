# Visual fidelity ledger

Compared `visual-concept.png` with `desktop-ready.png` and `mobile-ready.png` after the final browser build.

| Comparison point | Concept evidence | Render evidence | Resolution |
|---|---|---|---|
| Overall composition | Two-column study/control console over a full-width provenance rail | Desktop render preserves the same column split and rail order | Matched |
| Palette | Off-white base, white surfaces, restrained teal controls | Render uses `#F7F7F6`, white surfaces, and `#087F73` accents | Matched |
| Type hierarchy | Large study title, compact uppercase metadata, tabular metrics | Render preserves hierarchy with tighter browser-native text | Matched |
| Consent and limits | Start is primary; pause/stop disabled before opt-in; sliders and toggles exposed | Ready screenshot shows exactly those states | Matched |
| Work-unit motif | Thin row of square gray/teal cells | Render uses 24 responsive cells with completed, active, and pending states | Matched and made functional |
| Provenance | Five-column open verification rail | Render preserves five columns and content-addressed values | Matched; signature verification added |
| Mobile continuation | Single-column collapse with the workflow preserved | 390 px render has no horizontal overflow and retains all controls | Matched |

Intentional differences: the render uses browser-native range controls and adds a researcher review dialog, receipt state, and semantic footer links required by the workflow. These additions use the accepted visual system and do not alter the primary composition.
