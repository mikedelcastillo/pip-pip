import { test, expect, Page } from "@playwright/test"

// Recovery + archive UX, asserted on BOTH the mobile (touch) and desktop projects.
// The headline test reproduces the real incident: a large map that was saved to the
// library but is too big to load (it overflows the world-extent guard), so it shows
// as "Needs recovery". The Recover tool must auto-fix it back into a loadable map.

const LIBRARY_KEY = "pip-pip:map-library"

// A 200x10 map at the default cell size overflows WORLD_QUANT_RANGE (8192), so the
// validator rejects it on load even though every tile is intact - exactly the case
// that blanked the niece's map.
function oversizedMap(name: string){
    const cols = 200
    const rows = 10
    return {
        name, cellSize: 72, cols, rows,
        tiles: new Array(cols * rows).fill(1),
        spawns: [[0, 0]],
        palette: [{ key: "tile_default", shape: "full" }],
    }
}

function smallMap(name: string){
    return {
        name, cellSize: 72, cols: 4, rows: 4,
        tiles: new Array(16).fill(1),
        spawns: [[0, 0]],
        palette: [{ key: "tile_default", shape: "full" }],
    }
}

async function seedLibrary(page: Page, record: Record<string, { data: string, savedAt: number }>){
    await page.evaluate(({ key, value }) => {
        window.localStorage.setItem(key, value)
    }, { key: LIBRARY_KEY, value: JSON.stringify(record) })
}

test.describe("map recovery", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/maps")
        await page.evaluate(() => window.localStorage.clear())
    })

    test("auto-fixes an unreadable (oversized) map back into the library", async ({ page }) => {
        await seedLibrary(page, { "My Masterpiece": { data: JSON.stringify(oversizedMap("My Masterpiece")), savedAt: 1 } })
        await page.reload()

        // The broken map shows as needing recovery, and the tool badges a count.
        await expect(page.getByText("Needs recovery")).toBeVisible()
        const recoverBtn = page.getByRole("button", { name: /Recover lost maps/ })
        await expect(recoverBtn).toContainText("(1)")

        // Open the recovery tool: the candidate is listed as fixable.
        await recoverBtn.click()
        await expect(page.getByText("Needs a quick fix")).toBeVisible()

        // Auto-fix and restore, then close the tool.
        await page.getByRole("button", { name: "Auto-fix and restore" }).click()
        await expect(page.getByText(/Restored ".*" to your library/)).toBeVisible()
        await page.getByRole("button", { name: "Close" }).click()

        // The card now loads: no map is left needing recovery.
        await expect(page.getByText("Needs recovery")).toHaveCount(0)
    })

    test("Delete moves a map to the archive and it can be restored", async ({ page }) => {
        await seedLibrary(page, { Keeper: { data: JSON.stringify(smallMap("Keeper")), savedAt: 1 } })
        await page.reload()

        await page.getByRole("button", { name: "Delete Keeper" }).click()
        await page.getByRole("button", { name: "Delete", exact: true }).click()
        await expect(page.getByText(/Moved "Keeper" to the archive/)).toBeVisible()

        const archiveBtn = page.getByRole("button", { name: /Archive/ })
        await expect(archiveBtn).toContainText("(1)")
        await archiveBtn.click()
        await expect(page.getByText("Archived maps", { exact: true })).toBeVisible()
        await page.getByRole("button", { name: "Restore" }).click()
        await expect(page.getByText(/Restored "Keeper" to your library/)).toBeVisible()
    })

    test("recovery actions are comfortable touch targets", async ({ page }) => {
        await seedLibrary(page, { "Touch Map": { data: JSON.stringify(oversizedMap("Touch Map")), savedAt: 1 } })
        await page.reload()
        await page.getByRole("button", { name: /Recover lost maps/ }).click()
        const fix = page.getByRole("button", { name: "Auto-fix and restore" })
        const box = await fix.boundingBox()
        expect(box).not.toBeNull()
        if(box) expect(box.height).toBeGreaterThanOrEqual(44)
    })
})
