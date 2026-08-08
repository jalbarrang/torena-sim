## Purpose

Defines how the Carat Calculator page arranges its three parts — planner assumptions, summary statistics, and the banner plan — so that every projection the tool produces is readable without horizontal scrolling, at both wide and narrow viewports.

## ADDED Requirements

### Requirement: Page never scrolls horizontally

The Carat Calculator page SHALL NOT produce horizontal scrolling of the page itself at any supported viewport width. Content wider than the available space SHALL scroll within its own container.

Supported viewport widths are 360 pixels and above.

#### Scenario: Wide viewport with a populated plan

- **WHEN** the page is rendered at a viewport width of 1440 pixels with at least two planned banners
- **THEN** the scrollable width of the page container does not exceed its visible width

#### Scenario: Narrow viewport with a populated plan

- **WHEN** the page is rendered at a viewport width of 360 pixels with at least two planned banners
- **THEN** the scrollable width of the page container does not exceed its visible width

#### Scenario: Content exceeds its container

- **WHEN** the banner plan requires more width than the page can give it
- **THEN** the banner plan scrolls horizontally within its own bounds
- **AND** the page container itself does not scroll horizontally

### Requirement: Banner plan occupies the full content width

The banner plan SHALL span the full content width of the page. No persistent sibling element SHALL reduce the width available to it.

#### Scenario: Odds column is visible without scrolling

- **WHEN** the page is rendered at a viewport width of 1440 pixels with at least one planned banner
- **THEN** the odds and result information for each planned banner is fully visible
- **AND** reaching it requires no horizontal scrolling

### Requirement: Planner assumptions are grouped into a collapsible band

Settings that determine the projection SHALL be presented in a single collapsible band positioned above the banner plan. The band SHALL be collapsed when the page first renders.

The band SHALL contain exactly three groups, selectable one at a time:

- **Balance** — the carats and tickets the plan starts from, and the date the plan starts.
- **Income** — recurring income and the settings that determine it.
- **Rewards** — event and calendar income counted automatically into the projection.

#### Scenario: Band starts collapsed

- **WHEN** a user opens the Carat Calculator
- **THEN** the assumptions band is collapsed
- **AND** the banner plan is visible without scrolling past a band of settings

#### Scenario: Expanding the band

- **WHEN** a user expands the assumptions band
- **THEN** one of the three groups is shown
- **AND** the other two are selectable

#### Scenario: Only one group is shown at a time

- **WHEN** a user selects a different group within the expanded band
- **THEN** the newly selected group's settings replace the previously shown group's settings

### Requirement: Collapsed band summarizes the assumptions it hides

While collapsed, the band SHALL display a summary of the values it contains, sufficient to explain a projection without expanding the band.

The summary SHALL report the starting carat total, the number of active income sources, and the number of reward sources counted.

#### Scenario: Summary reflects current values

- **WHEN** the assumptions band is collapsed and the plan starts from 24,500 carats
- **THEN** the collapsed band reports 24,500 starting carats

#### Scenario: Summary updates after an edit

- **WHEN** a user expands the band, changes the starting carat total, and collapses the band
- **THEN** the collapsed summary reports the new total

### Requirement: Starting carats and tickets are edited in the Balance group

Starting free carats, starting paid carats, uma tickets, and support tickets SHALL be edited within the Balance group of the assumptions band. They SHALL NOT appear as an entry in the banner plan.

#### Scenario: Starting resources are absent from the plan

- **WHEN** a user views the banner plan
- **THEN** the first entry is a planned banner, or the empty state if no banners are planned
- **AND** no entry for starting carats or tickets appears in the plan

#### Scenario: Editing starting resources updates the projection

- **WHEN** a user changes the starting free carat total in the Balance group
- **THEN** the projected balance and per-banner affordability update to reflect the new total

#### Scenario: Empty state directs users to the Balance group

- **WHEN** no banners are planned
- **THEN** the empty state instructs the user to set starting carats and tickets in the assumptions band
- **AND** the instruction does not refer to a location within the plan

### Requirement: Summary statistics are presented as a single compact strip

The plan's headline figures SHALL be presented as one horizontal strip rather than as a grid of cards.

#### Scenario: Statistics remain available

- **WHEN** a user views the Carat Calculator
- **THEN** the projected balance, current carats, starting tickets, monthly income, and total spend are all visible without expanding or scrolling any container

#### Scenario: Strip wraps at narrow widths

- **WHEN** the page is rendered at a viewport width of 360 pixels
- **THEN** the statistics wrap onto multiple lines
- **AND** no statistic is clipped or truncated

### Requirement: Layout structure is consistent across viewports

The page SHALL present the same ordering of parts at every viewport width: assumptions band, then summary statistics, then banner plan. Only the internal presentation of each part SHALL vary by width.

#### Scenario: Narrow viewport preserves ordering

- **WHEN** the page is rendered at a viewport width below 1024 pixels
- **THEN** the assumptions band, summary statistics, and banner plan appear in that order
- **AND** the banner plan presents each planned banner as a stacked card

#### Scenario: Wide viewport preserves ordering

- **WHEN** the page is rendered at a viewport width of 1024 pixels or above
- **THEN** the assumptions band, summary statistics, and banner plan appear in that order
- **AND** the banner plan presents each planned banner as a table row

### Requirement: Saved plans remain compatible

The layout change SHALL NOT alter the stored representation of a plan. Plans saved before the change SHALL load without migration, and share codes SHALL remain interchangeable across the change.

#### Scenario: Existing saved plan loads

- **WHEN** a plan saved before this change is loaded
- **THEN** all settings, planned banners, and results appear unchanged
- **AND** no migration prompt or data loss occurs

#### Scenario: Share code round-trip

- **WHEN** a share code generated before this change is imported
- **THEN** the resulting plan matches the plan that produced the code

### Requirement: Guided tour reaches every relocated element

The guided tour SHALL successfully highlight each step's target after the layout change, including targets that have moved into the assumptions band.

#### Scenario: Tour completes end to end

- **WHEN** a user starts the guided tour
- **THEN** every step highlights an element that exists on the page
- **AND** the tour advances to completion without a missing-target failure

#### Scenario: Tour reveals collapsed content

- **WHEN** a tour step targets an element inside the collapsed assumptions band
- **THEN** the band expands to the group containing that element before the step is shown

### Requirement: Reordering planned banners is preserved

Drag-and-drop reordering of planned banners SHALL continue to work at every viewport width, including when the plan extends beyond the visible area.

#### Scenario: Reorder within the visible area

- **WHEN** a user drags a planned banner above another planned banner
- **THEN** the plan order updates to match the drop position

#### Scenario: Reorder requiring scroll

- **WHEN** a user drags a planned banner toward the edge of the visible area and the plan extends beyond it
- **THEN** the view scrolls to reveal the drop target
- **AND** the drop completes at the intended position
