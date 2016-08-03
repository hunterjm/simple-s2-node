'use strict'

const bignum = require('bn').BigInteger;
const Utils = require('./utils');

const LINEAR_PROJECTION = 0;
const TAN_PROJECTION = 1;
const QUADRATIC_PROJECTION = 2;

const PROJECTION = QUADRATIC_PROJECTION;

const LOOKUP_BITS = 4;
const SWAP_MASK = 0x01;
const INVERT_MASK = 0x02;

const MAX_LEVEL = 30;
const NUM_FACES = 6;
const POS_BITS = 2 * MAX_LEVEL + 1;
const MAX_SIZE = 1 << MAX_LEVEL;
const WRAP_OFFSET = new bignum(NUM_FACES+'').shiftLeft(POS_BITS);

const POS_TO_IJ = [
	[0, 1, 3, 2],
	[0, 2, 3, 1],
	[3, 2, 0, 1],
	[3, 1, 0, 2]
];
const POS_TO_ORIENTATION = [SWAP_MASK, 0, 0, INVERT_MASK | SWAP_MASK];
var LOOKUP_POS = [];
LOOKUP_POS.length = (1 << (2 * LOOKUP_BITS + 2));
var LOOKUP_IJ = [];
LOOKUP_IJ.length = (1 << (2 * LOOKUP_BITS + 2));


function _init_lookup_cell(level, i, j, orig_orientation, pos, orientation) {
	if (level == LOOKUP_BITS) {
		var ij = (i << LOOKUP_BITS) + j;
		LOOKUP_POS[(ij << 2) + orig_orientation] = (pos << 2) + orientation;
		LOOKUP_IJ[(pos << 2) + orig_orientation] = (ij << 2) + orientation;
	}
	else {
		level = level + 1;
		i <<= 1;
		j <<= 1;
		pos <<= 2;
		var r = POS_TO_IJ[orientation];
		for (var index = 0; index < 4; index++)// in range(4):
		_init_lookup_cell(
			level, i + (r[index] >> 1),
			j + (r[index] & 1), orig_orientation,
			pos + index, orientation ^ POS_TO_ORIENTATION[index]
		);
	}
}

_init_lookup_cell(0, 0, 0, 0, 0, 0)
_init_lookup_cell(0, 0, 0, SWAP_MASK, 0, SWAP_MASK)
_init_lookup_cell(0, 0, 0, INVERT_MASK, 0, INVERT_MASK)
_init_lookup_cell(0, 0, 0, SWAP_MASK | INVERT_MASK, 0, SWAP_MASK | INVERT_MASK)

function uv_to_st(u) {
	if (PROJECTION == LINEAR_PROJECTION)
	return 0.5 * (u + 1)
	else if (PROJECTION == TAN_PROJECTION)
	return (2 * (1.0 / Math.PI)) * (Math.atan(u) * Math.PI / 4.0)
	else if (PROJECTION == QUADRATIC_PROJECTION) {
		if (u >= 0)
		return 0.5 * Math.sqrt(1 + 3 * u);
		else
		return 1 - 0.5 * Math.sqrt(1 - 3 * u);
	}
	else
	throw 'unknown projection type';
};

// clamp returns number closest to x within the range min..max.
function clamp(x, min, max) {
	if (x < min) {
		return min;
	}
	if (x > max) {
		return max;
	}
	return x;
}

function st_to_ij(s) {
	return clamp(Math.floor(MAX_SIZE * s), 0, MAX_SIZE - 1);
};

class CellId {
	constructor(cellId){

		if( typeof cellId !== "undefined"){
			if (cellId.intValue() < 0)
				cellId = cellId.add( new bignum('10000000000000000', 16).subtract(1));

			this.cellId = cellId.mod(new bignum('ffffffffffffffff', 16));
		}
	}

	id() {
		return this.cellId;
	}

	lsb() {
		if (this.cellId.toString() === "0")
			return bignum.ZERO;

		var lsb = bignum.ONE;
		do {
			if (this.cellId.and(lsb).toString() !== "0")
				return lsb;

			lsb = lsb.shiftLeft(1);
		} while (true);

		//return this.cellId & (-this.cellId);
	}

	level() {
		var x = new bignum(this.cellId.toString());
	  var level = -1;
	  if (x.toString() !== "0") {
	    level += 16;
	  } else {
	    x = x.shiftRight(32);
	  }
	  // We only need to look at even-numbered bits to determine the
	  // level of a valid cell id.
		x = x.and(x.negate());
	  if (x.and(new bignum("21845")).toString() !== "0") level += 8;
		if (x.and(new bignum("5570645")).toString() !== "0") level += 4;
		if (x.and(new bignum("84215045")).toString() !== "0") level += 2;
		if (x.and(new bignum("286331153")).toString() !== "0") level += 1;
		level = Math.max(Math.min(level, MAX_LEVEL), 0);
	  return level;
	}

	face() {
		return this.id().shiftRight(POS_BITS);
	}

	advance(steps) {
	  if (steps == 0) return this.cellId.clone();

	  // We clamp the number of steps if necessary to ensure that we do not
	  // advance past the End() or before the Begin() of this level.  Note that
	  // min_steps and max_steps always fit in a signed 64-bit integer.

		steps = new bignum(steps.toString());
	  var step_shift = 2 * (MAX_LEVEL - this.level()) + 1;
	  if (parseInt(steps.toString(), 10) < 0) {
	    var min_steps = this.cellId.shiftRight(step_shift).negate() //-static_cast<int64>(id_ >> step_shift);
	    if (steps.compareTo(min_steps) === -1) steps = min_steps;
	  } else {
	    var max_steps = WRAP_OFFSET.add(this.lsb()).subtract(this.cellId).shiftRight(step_shift);
	    if (steps.compareTo(max_steps) === 1) steps = max_steps;
	  }
	  return new CellId(this.cellId.add(steps.shiftLeft(step_shift)));
	}

	// AdvanceWrap advances or retreats the indicated number of steps along the
	// Hilbert curve at the current level and returns the new position. The
	// position wraps between the first and last faces as necessary.
	advance_wrap(steps) {
		if (steps == 0) {
			return this.cellId.clone();
		}

		var bigSteps = new bignum(steps.toString());
		// We clamp the number of steps if necessary to ensure that we do not
		// advance past the End() or before the Begin() of this level.
		var shift = 2*(MAX_LEVEL-this.level()) + 1;
		if (steps < 0) {
			var min = this.id().shiftRight(shift).negate();
			if (bigSteps.compareTo(min) === -1) {
				var wrap = WRAP_OFFSET >> shift;
				steps = steps % wrap;
				bigSteps = new bignum(steps.toString());
				if (bigSteps.compareTo(min) === -1) {
					steps += wrap;
					bigSteps = new bignum(steps.toString());
				}
			}
		} else {
			// Unlike Advance(), we don't want to return End(level).
			var max = WRAP_OFFSET.subtract(this.id()).shiftRight(shift);
			if (bigSteps.compareTo(max) === 1) {
				var wrap = WRAP_OFFSET.shiftRight(shift).intValue();
				steps = steps % wrap;
				bigSteps = new bignum(steps.toString());
				if (bigSteps.compareTo(max) === 1) {
					steps -= wrap;
					bigSteps = new bignum(steps.toString());
				}
			}
		}

		// If steps is negative, then shifting it left has undefined behavior.
		// Cast to uint64 for a 2's complement answer.
		return new CellId(this.id().add(bigSteps.shiftLeft(shift)));
	}

	prev() {
		var level = this.level();
		var prev = this.advance_wrap(-1);
		if (prev.level() !== level) prev = prev.parent(level);
		return prev;
	}

	next() {
		var level = this.level();
		var next = this.advance_wrap(1);
		if (next.level() !== level) next = next.parent(level);
		return next;
	}

	// EdgeNeighbors returns the four cells that are adjacent across the cell's four edges.
	// Edges 0, 1, 2, 3 are in the down, right, up, left directions in the face space.
	// All neighbors are guaranteed to be distinct.
	edgeNeighbors() {
		var level = this.level();
		var size = this.size_ij(level).intValue();
		const { f, i, j } = this.faceij_orientation();
		return [
			new CellId().from_face_ij_wrap(f, i, j-size).parent(level),
			new CellId().from_face_ij_wrap(f, i+size, j).parent(level),
			new CellId().from_face_ij_wrap(f, i, j+size).parent(level),
			new CellId().from_face_ij_wrap(f, i-size, j).parent(level)
		];
	}

	lsb_for_level(level) {
		return new bignum("1").shiftLeft(2 * (MAX_LEVEL - level));
	}

	size_ij(level) {
		return bignum("1").shiftLeft(MAX_LEVEL - level);
	}

	// faceIJOrientation uses the global lookupIJ table to unfiddle the bits of ci.
	faceij_orientation() {
		var f = this.face().intValue();
		var i = 0;
		var j = 0;
		var tj;
		var orientation = f & SWAP_MASK;
		var nbits = MAX_LEVEL - 7 * LOOKUP_BITS // first iteration

		for (var k = 7; k >= 0; k--) {
			// (int(uint64(ci)>>uint64(k*2*lookupBits+1)) & ((1 << uint((2 * nbits))) - 1)) << 2
			orientation += (this.id().shiftRight(k * 2 * LOOKUP_BITS + 1).intValue() & ((1 << (2 * nbits)) - 1)) << 2;
			orientation = LOOKUP_IJ[orientation];
			i += (orientation >> (LOOKUP_BITS + 2)) << (k * LOOKUP_BITS);
			// ((orientation >> 2) & ((1 << LOOKUP_BITS) - 1)) << (k * LOOKUP_BITS);
			j += ((orientation >> 2) & ((1 << LOOKUP_BITS) - 1)) << (k * LOOKUP_BITS);
			orientation = orientation & (SWAP_MASK | INVERT_MASK);
			nbits = LOOKUP_BITS // following iterations
		}

		if (this.lsb().and(new bignum("1229782938247303440")).toString() !== "0") {
			orientation = orientation ^ SWAP_MASK;
		}

		return { f, i, j, orientation };
	}

	parent(level) {
		var new_lsb = this.lsb_for_level(level);
		var parent = this.cellId.and(new_lsb.negate()).or(new_lsb);
		if (this.level() === 30) {
			parent = parent.subtract(bignum.ONE);
		}
		return new CellId(parent);
	}


	from_lat_lng(latLng) {
		return this.from_point(latLng.to_point());
	}

	from_point(point) {
		var fuv = Utils.xyz_to_face_uv(point);

		var face = fuv[0];
		var u = fuv[1];
		var v = fuv[2];
		var i = st_to_ij(uv_to_st(u));
		var j = st_to_ij(uv_to_st(v));

		return this.from_face_ij(face, i, j);
	}

	from_face_ij(face, i, j) {
		var n = (new bignum(String(face))).shiftLeft(POS_BITS - 1);//face << (POS_BITS - 1);
		var bits = face & SWAP_MASK;

		for (var k = 7; k > -1; k--) {// in range(7, -1, -1):
			var mask = (1 << LOOKUP_BITS) - 1;
			bits += (((i >> (k * LOOKUP_BITS)) & mask) << (LOOKUP_BITS + 2));
			bits += (((j >> (k * LOOKUP_BITS)) & mask) << 2);
			bits = LOOKUP_POS[bits];
			n = n.or(  ( new bignum(String(bits))).shiftRight(2).shiftLeft(k * 2 * LOOKUP_BITS));//n |= (bits >> 2) << (k * 2 * LOOKUP_BITS);
			bits &= (SWAP_MASK | INVERT_MASK);
		}

		// when using BigInteger we get a number that is +1 larger that the result
		// we got while using binary openssl functions from "bignum" package.
		// that's why 'add(new bignum("1")' was removed.

		//return new CellId(n.multiply( new bignum("2"))/*.add(new bignum("1"))*/);
		return new CellId(n.multiply( new bignum("2")) );
	}

	from_face_ij_wrap(f, i, j) {
		// Convert i and j to the coordinates of a leaf cell just beyond the
		// boundary of this face.  This prevents 32-bit overflow in the case
		// of finding the neighbors of a face cell.
		i = clamp(i, -1, MAX_SIZE);
		j = clamp(j, -1, MAX_SIZE);

		// We want to wrap these coordinates onto the appropriate adjacent face.
		// The easiest way to do this is to convert the (i,j) coordinates to (x,y,z)
		// (which yields a point outside the normal face boundary), and then call
		// xyzToFaceUV to project back onto the correct face.
		//
		// The code below converts (i,j) to (si,ti), and then (si,ti) to (u,v) using
		// the linear projection (u=2*s-1 and v=2*t-1).  (The code further below
		// converts back using the inverse projection, s=0.5*(u+1) and t=0.5*(v+1).
		// Any projection would work here, so we use the simplest.)  We also clamp
		// the (u,v) coordinates so that the point is barely outside the
		// [-1,1]x[-1,1] face rectangle, since otherwise the reprojection step
		// (which divides by the new z coordinate) might change the other
		// coordinates enough so that we end up in the wrong leaf cell.
		const scale = 1 / MAX_SIZE;
		var limit = 1.0000000000000002; //limit := math.Nextafter(1, 2)
		var u = Math.max(-limit, Math.min(limit, scale*((i<<1)+1-MAX_SIZE)));
		var v = Math.max(-limit, Math.min(limit, scale*((j<<1)+1-MAX_SIZE)));

		// Find the leaf cell coordinates on the adjacent face, and convert
		// them to a cell id at the appropriate level.
		var fuv = Utils.xyz_to_face_uv(Utils.face_uv_to_xyz(f, u, v));
		var f = fuv[0];
		var u = fuv[1];
		var v = fuv[2];
		return new CellId().from_face_ij(f, st_to_ij(0.5*(u+1)), st_to_ij(0.5*(v+1)));
	}

	toLong(signed) {
		return Utils.long_from_bignum(this.id(), signed);
	}
}

module.exports = CellId;
