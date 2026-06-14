import { test, expect } from "@playwright/test"

// Baseline home-screen usability, asserted on BOTH the mobile (touch) and
// desktop (mouse) projects defined in playwright.config.ts. This proves the
// harness boots the client+server stack and that the primary entry controls
// are reachable on a phone without horizontal overflow.

const PRIMARY_CONTROLS = [
    "Host Game",
    "Join Public Match",
    "Join Game",
    "Settings",
    "Credits",
]

test.describe("home screen", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/")
    })

    test("shows every primary control", async ({ page }) => {
        for (const label of PRIMARY_CONTROLS) {
            await expect(page.getByText(label, { exact: true })).toBeVisible()
        }
    })

    test("does not overflow horizontally", async ({ page }) => {
        // A phone must never need to scroll sideways to reach a control.
        const overflow = await page.evaluate(() => {
            const el = document.documentElement
            return el.scrollWidth - el.clientWidth
        })
        expect(overflow).toBeLessThanOrEqual(1)
    })

    test("each primary control sits within the viewport width", async ({ page }, testInfo) => {
        const width = page.viewportSize()?.width ?? 0
        for (const label of PRIMARY_CONTROLS) {
            const box = await page.getByText(label, { exact: true }).boundingBox()
            expect(box, `${label} should have a layout box`).not.toBeNull()
            if (box) {
                expect(box.x, `${label} left edge on ${testInfo.project.name}`).toBeGreaterThanOrEqual(0)
                expect(box.x + box.width, `${label} right edge on ${testInfo.project.name}`).toBeLessThanOrEqual(width + 1)
            }
        }
    })
})
