# Interface design system

Use Bootstrap 5.3 for layout, components, spacing utilities, and typography classes.
Customize its appearance in `public/styles.css`; do not add a second CSS framework
or page-specific font/palette in templates.

- Inter: interface headings, labels, buttons, tables, forms, body text.
- Playfair Display: page titles and explicitly chosen `.display-heading` elements.
- Controls: 8px corners; cards: 12px corners with a quiet border and light shadow.
- Spacing: Bootstrap spacing utilities; panel padding uses `--space-panel`.
- Forest/navy: primary actions. Gold: small brand accents and selected navigation.
- One primary action per section; secondary actions outlined or in More actions.
- Preserve visible keyboard focus and meaningful status labels alongside colors.

The class detail and class calendar layouts live in the shared stylesheet and use
the same theme tokens. Keep print-specific calendar layout rules intact.
