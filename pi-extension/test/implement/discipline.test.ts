import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    DEFAULT_HEURISTIC_CONFIG,
    detectFlakyTiming,
    detectGodTest,
    detectMirrorLogic,
    detectMysteryGuest,
    detectNoAAA,
    detectOverMocking,
    detectPrivateMethod,
    detectZeroAssertion,
    scanTestFiles,
    scanTestFilesOnDisk,
} from "../../src/implement/discipline.js";

const F = "/fake/path";

describe("detectZeroAssertion", () => {
    it("flags a test with no assert calls", () => {
        const noAssertContent = `
            it("does nothing", () => {
                const x = 1;
                console.log(x);
            });
        `;
        const noAssert = detectZeroAssertion(noAssertContent, F);
        assert.strictEqual(noAssert.length, 1);
        assert.strictEqual(noAssert[0].heuristic, "zero-assertion");
        assert.strictEqual(noAssert[0].severity, "blocking");
    });

    it("does NOT flag a test with assert.equal", () => {
        const content = `
            it("uses assert.equal", () => {
                assert.equal(1 + 1, 2);
            });
        `;
        const findings = detectZeroAssertion(content, F);
        assert.strictEqual(findings.length, 0);
    });

    it("does NOT flag a test with expect().toBe()", () => {
        const content = `
            it("uses expect", () => {
                expect(1 + 1).toBe(2);
            });
        `;
        const findings = detectZeroAssertion(content, F);
        assert.strictEqual(findings.length, 0);
    });

    it("does NOT flag a test with should()", () => {
        const content = `
            it("uses should", () => {
                (1 + 1).should.equal(2);
            });
        `;
        const findings = detectZeroAssertion(content, F);
        assert.strictEqual(findings.length, 0);
    });

    it("does NOT flag a test with chai", () => {
        const content = `
            it("uses chai", () => {
                chai.expect(1 + 1).to.equal(2);
            });
        `;
        const findings = detectZeroAssertion(content, F);
        assert.strictEqual(findings.length, 0);
    });

    it("does NOT flag a test with Jest toEqual matcher", () => {
        const content = `
            it("uses toEqual", () => {
                expect({ a: 1 }).toEqual({ a: 1 });
            });
        `;
        const findings = detectZeroAssertion(content, F);
        assert.strictEqual(findings.length, 0);
    });
});

describe("detectOverMocking", () => {
    it("flags a test with 4 mock calls (threshold = 3)", () => {
        const content = `
            it("uses too many mocks", () => {
                const a = mock(b);
                const c = jest.fn();
                const d = sinon.stub();
                const e = spyOn(obj, 'm');
                assert.ok(true);
            });
        `;
        const findings = detectOverMocking(content, F, 3);
        assert.strictEqual(findings.length, 1);
        assert.strictEqual(findings[0].heuristic, "over-mocking");
        assert.strictEqual(findings[0].severity, "blocking");
    });

    it("does NOT flag a test with exactly 3 mock calls (boundary)", () => {
        const content = `
            it("uses three mocks", () => {
                const a = mock(b);
                const c = jest.fn();
                const d = sinon.stub();
                assert.ok(true);
            });
        `;
        const findings = detectOverMocking(content, F, 3);
        assert.strictEqual(findings.length, 0);
    });

    it("counts jest.fn, sinon.stub, spyOn, mockReturnValue", () => {
        const content = `
            it("uses many mock forms", () => {
                jest.fn();
                sinon.stub();
                spyOn(x, 'm');
                mockReturnValue(1);
                assert.ok(true);
            });
        `;
        const findings = detectOverMocking(content, F, 3);
        assert.strictEqual(findings.length, 1);
    });

    it("honors custom threshold", () => {
        const content = `
            it("two mocks", () => {
                jest.fn();
                sinon.stub();
                assert.ok(true);
            });
        `;
        // threshold 1 → fires (2 > 1)
        assert.strictEqual(detectOverMocking(content, F, 1).length, 1);
        // threshold 3 → does not fire (2 ≤ 3)
        assert.strictEqual(detectOverMocking(content, F, 3).length, 0);
    });
});

describe("detectMirrorLogic", () => {
    it("flags assert(decode(x), decode(x)) — identical LHS/RHS", () => {
        const content = `
            it("mirrors logic", () => {
                assert(decode(x), decode(x));
            });
        `;
        const findings = detectMirrorLogic(content, F);
        assert.strictEqual(findings.length, 1);
        assert.strictEqual(findings[0].heuristic, "mirror-logic");
    });

    it("does NOT flag a test with a call on either side", () => {
        // We can't reliably tell, so the false-positive guard skips when one side has any function call.
        const content = `
            it("calls a function", () => {
                assert(decode(encode(x)), x);
            });
        `;
        const findings = detectMirrorLogic(content, F);
        // Both sides have function calls — but the current rule only flags identical LHS/RHS.
        // This test confirms it doesn't false-positive on inverse functions.
        assert.strictEqual(findings.length, 0);
    });

    it("does NOT flag when expressions differ", () => {
        const content = `
            it("different expressions", () => {
                assert(sum, expected);
            });
        `;
        const findings = detectMirrorLogic(content, F);
        assert.strictEqual(findings.length, 0);
    });
});

describe("detectFlakyTiming", () => {
    it("flags sleep(1000)", () => {
        const content = `
            it("sleeps", () => {
                sleep(1000);
                assert.ok(true);
            });
        `;
        const findings = detectFlakyTiming(content, F);
        assert.strictEqual(findings.length, 1);
        assert.strictEqual(findings[0].heuristic, "flaky-timing");
    });

    it("flags setTimeout(...)", () => {
        const content = `
            it("waits", () => {
                setTimeout(() => {}, 1000);
                assert.ok(true);
            });
        `;
        const findings = detectFlakyTiming(content, F);
        assert.ok(findings.length >= 1);
    });

    it("does NOT flag when inside a pollUntil() helper", () => {
        const content = `
            it("polls", () => {
                pollUntil(() => isReady(), 1000);
                assert.ok(true);
            });
        `;
        const findings = detectFlakyTiming(content, F);
        assert.strictEqual(findings.length, 0);
    });

    it("does NOT flag when inside an eventually() helper", () => {
        const content = `
            it("eventually", () => {
                eventually(() => isReady());
                assert.ok(true);
            });
        `;
        const findings = detectFlakyTiming(content, F);
        assert.strictEqual(findings.length, 0);
    });
});

describe("detectNoAAA", () => {
    it("flags a 10-line body with no blank line and no AAA comments", () => {
        const content = `
            it("no aaa", () => {
                const a = 1;
                const b = 2;
                const c = 3;
                const d = 4;
                const e = 5;
                const f = 6;
                const g = 7;
                assert.equal(a + b, c);
            });
        `;
        const findings = detectNoAAA(content, F);
        assert.strictEqual(findings.length, 1);
        assert.strictEqual(findings[0].heuristic, "no-aaa");
        assert.strictEqual(findings[0].severity, "informational");
    });

    it("does NOT flag when AAA comments are present", () => {
        const content = `
            it("with aaa", () => {
                // Arrange
                const a = 1;
                // Act
                const b = a + 1;
                // Assert
                assert.equal(b, 2);
            });
        `;
        const findings = detectNoAAA(content, F);
        assert.strictEqual(findings.length, 0);
    });

    it("does NOT flag short bodies", () => {
        const content = `
            it("short", () => {
                assert.equal(1, 1);
            });
        `;
        const findings = detectNoAAA(content, F);
        assert.strictEqual(findings.length, 0);
    });
});

describe("detectMysteryGuest", () => {
    it("flags a readFileSync('secrets.json') with no fixtures", () => {
        const content = `
            it("reads secrets", () => {
                const s = readFileSync('secrets.json');
                assert.ok(s);
            });
        `;
        const findings = detectMysteryGuest(content, F);
        assert.strictEqual(findings.length, 1);
        assert.strictEqual(findings[0].heuristic, "mystery-guest");
    });

    it("does NOT flag a readFileSync('fixtures/data.json') when 'fixtures/' is in fixturePaths", () => {
        const content = `
            it("reads fixtures", () => {
                const d = readFileSync('fixtures/data.json');
                assert.ok(d);
            });
        `;
        const findings = detectMysteryGuest(content, F, ["fixtures/"]);
        assert.strictEqual(findings.length, 0);
    });
});

describe("detectPrivateMethod", () => {
    it("flags a call to ._helper()", () => {
        const content = `
            it("calls private", () => {
                expect(obj._helper()).toBe(1);
            });
        `;
        const findings = detectPrivateMethod(content, F);
        assert.strictEqual(findings.length, 1);
        assert.strictEqual(findings[0].heuristic, "private-method");
    });

    it("flags a call to a method tagged @private (standalone)", () => {
        const content = `
            it("standalone private", () => {
                _helper(1, 2);
                assert.ok(true);
            });
        `;
        const findings = detectPrivateMethod(content, F);
        assert.ok(findings.length >= 1);
    });

    it("does NOT flag a call to public API", () => {
        const content = `
            it("public", () => {
                expect(obj.helper()).toBe(1);
            });
        `;
        const findings = detectPrivateMethod(content, F);
        assert.strictEqual(findings.length, 0);
    });
});

describe("detectGodTest", () => {
    it("flags a test with 6 asserts on different lines", () => {
        const lines = ["it('big', () => {", "    assert.equal(1, 1);",
            "    assert.equal(2, 2);", "    assert.equal(3, 3);",
            "    assert.equal(4, 4);", "    assert.equal(5, 5);",
            "    assert.equal(6, 6);", "});"];
        const content = lines.join("\n");
        const findings = detectGodTest(content, F, 5, 50);
        assert.strictEqual(findings.length >= 1, true);
        assert.strictEqual(findings[0].heuristic, "god-test");
    });

    it("does NOT flag a test with 5 asserts (boundary)", () => {
        const lines = ["it('five', () => {", "    assert.equal(1, 1);",
            "    assert.equal(2, 2);", "    assert.equal(3, 3);",
            "    assert.equal(4, 4);", "    assert.equal(5, 5);", "});"];
        const content = lines.join("\n");
        const findings = detectGodTest(content, F, 5, 50);
        assert.strictEqual(findings.length, 0);
    });

    it("flags a 60-line test body", () => {
        const lines = ["it('long', () => {"];
        for (let i = 0; i < 60; i++) lines.push(`    const x${i} = ${i};`);
        lines.push("    assert.equal(1, 1);", "});");
        const content = lines.join("\n");
        const findings = detectGodTest(content, F, 5, 50);
        assert.ok(findings.length >= 1);
    });

    it("does NOT flag a 50-line test body (boundary)", () => {
        const lines = ["it('50', () => {"];
        for (let i = 0; i < 47; i++) lines.push(`    const x${i} = ${i};`);
        lines.push("    assert.equal(1, 1);", "});");
        const content = lines.join("\n");
        const findings = detectGodTest(content, F, 5, 50);
        assert.strictEqual(findings.length, 0);
    });
});

describe("scanTestFiles", () => {
    it("aggregates findings across multiple files", () => {
        const f1 = { path: "/a.ts", content: "it('no assert', () => { const x = 1; });" };
        const f2 = { path: "/b.ts", content: "it('has assert', () => { assert.equal(1, 1); });" };
        const report = scanTestFiles([f1, f2]);
        assert.strictEqual(report.scannedFiles, 2);
        assert.ok(report.findings.length >= 1);
        assert.ok(report.byHeuristic["zero-assertion"] >= 1);
    });

    it("returns a zero-finding report for clean tests", () => {
        const f1 = { path: "/a.ts", content: "it('clean', () => { assert.equal(1, 1); });" };
        const report = scanTestFiles([f1]);
        assert.strictEqual(report.scannedFiles, 1);
        assert.strictEqual(report.blockingCount, 0);
    });

    it("counts findings by heuristic and severity", () => {
        const f1 = { path: "/a.ts", content: "it('many', () => { jest.fn(); sinon.stub(); spyOn(x, 'm'); mockReturnValue(1); assert.equal(1, 1); });" };
        const report = scanTestFiles([f1]);
        assert.ok(report.byHeuristic["over-mocking"] >= 1);
        assert.ok(report.bySeverity.blocking >= 1);
    });

    it("computes blockingCount correctly", () => {
        const f1 = { path: "/a.ts", content: "it('zero', () => { const x = 1; });" };
        const report = scanTestFiles([f1]);
        assert.strictEqual(report.blockingCount, 1);
    });
});

describe("scanTestFilesOnDisk", () => {
    it("skips files that cannot be read", () => {
        const report = scanTestFilesOnDisk(["/this/does/not/exist.ts"]);
        assert.strictEqual(report.scannedFiles, 0);
        assert.strictEqual(report.findings.length, 0);
    });

    it("reads real files and reports findings", () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-real-"));
        const file = path.join(tmpDir, "test_sample.ts");
        fs.writeFileSync(file, "it('no assert', () => { const x = 1; });", "utf8");
        const report = scanTestFilesOnDisk([file]);
        assert.strictEqual(report.scannedFiles, 1);
        assert.ok(report.findings.some((f) => f.heuristic === "zero-assertion"));
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
});

describe("false-positive guards (critical for senior dev trust)", () => {
    it("does NOT flag a Pytest parametrize test as no-AAA", () => {
        // Pytest uses `def test_x():` blocks; the AAA heuristic should still work but
        // the body is short enough not to fire.
        const content = `
            def test_sum():
                # arrange
                a = 1
                b = 2
                # act
                result = a + b
                # assert
                assert result == 3
        `;
        const findings = detectNoAAA(content, F);
        assert.strictEqual(findings.length, 0);
    });

    it("does NOT flag an RSpec shared example as god-test", () => {
        const content = `
            it_behaves_like "a sortable collection" do
                let(:items) { [3, 1, 2] }
                it "sorts ascending" do
                    expect(items.sort).to eq([1, 2, 3])
                end
                it "sorts descending" do
                    expect(items.sort.reverse).to eq([3, 2, 1])
                end
            end
        `;
        const findings = detectGodTest(content, F);
        assert.strictEqual(findings.length, 0);
    });

    it("does NOT flag a hypothesis @given test as zero-assertion when it has assertions inside", () => {
        const content = `
            @given(st.integers())
            def test_int_property(x):
                assert isinstance(x, int)
        `;
        const findings = detectZeroAssertion(content, F);
        assert.strictEqual(findings.length, 0);
    });

    it("does NOT flag a fast-check fc.assert test as zero-assertion", () => {
        const content = `
            it("property", () => {
                fc.assert(fc.property(fc.integer(), (n) => {
                    assert.equal(typeof n, "number");
                }));
            });
        `;
        const findings = detectZeroAssertion(content, F);
        assert.strictEqual(findings.length, 0);
    });
});

describe("DEFAULT_HEURISTIC_CONFIG", () => {
    it("matches the documented thresholds", () => {
        assert.strictEqual(DEFAULT_HEURISTIC_CONFIG.overMockingThreshold, 3);
        assert.strictEqual(DEFAULT_HEURISTIC_CONFIG.godTestAssertThreshold, 5);
        assert.strictEqual(DEFAULT_HEURISTIC_CONFIG.godTestBodyLengthThreshold, 50);
    });
});
