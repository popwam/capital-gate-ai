import * as assert from "node:assert/strict";
import { test } from "node:test";
import { ImportUnitOperation } from "@prisma/client";
import { rollbackConflict } from "./rollback-safety";

const base={operation:ImportUnitOperation.CREATED,unitExists:true,currentMatchesAppliedSnapshot:true,laterImportExists:false,hasAttachedMedia:false};
test("untouched exclusively-created units are safe to remove",()=>assert.equal(rollbackConflict(base),null));
test("manual edits prevent destructive rollback",()=>assert.match(rollbackConflict({...base,currentMatchesAppliedSnapshot:false})!,/edited/));
test("a later import prevents an older batch rollback",()=>assert.match(rollbackConflict({...base,laterImportExists:true})!,/later import/));
test("shared media protects batch-created inventory",()=>assert.match(rollbackConflict({...base,hasAttachedMedia:true})!,/media/));
test("updated shared project units can restore when unchanged",()=>assert.equal(rollbackConflict({...base,operation:ImportUnitOperation.UPDATED,hasAttachedMedia:true}),null));
