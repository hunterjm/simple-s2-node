var s2 = require('../s2');
var bignum = require('bn').BigInteger;

var lat = 35.2271329;
var lng = -80.8430872;
lat = 40.758895;
lng = -73.9873197;
// lat = 51.501364;
// lng = -0.1440787;
// lat = -33.8479743;
// lng = 150.6517864;
// lat = 44.971647;
// lng = -93.329115;
// lat = 35.111631;
// lng = -81.0029286;

function getNeighbors(lat, lng) {
  var origin = new s2.S2CellId().from_lat_lng(new s2.S2LatLng().from_degrees(lat, lng)).parent(15);
  var walk = [origin.id().toString()];
  // 10 before and 10 after
  var next = origin.next();
  var prev = origin.prev();
  for (var i = 0; i < 10; i++) {
    // in range(10):
    walk.push(prev.id().toString());
    walk.push(next.id().toString());
    next = next.next();
    prev = prev.prev();
  }
  return walk;
}

// console.log(getNeighbors(lat, lng));

function getEdgeNeighbors(cell, walk, recurse, direction) {
	if(!recurse) recurse = 0;
	if(!walk) walk = [];
	walk.push(cell.id().toString());
	if(recurse < 3) {
		recurse++;
    // Edges 0, 1, 2, 3 are in the down, right, up, left directions in the face space.
		neighbors = cell.edgeNeighbors();
    var i = 0;
		for (const neighbor of neighbors) {
      if(recurse !== 3 || i !== direction) {
	      getEdgeNeighbors(neighbor, walk, recurse, i);
      }
      i++;
		}
	}
	// unique
	walk = walk.reduce(function(p, c) {
		if(p.indexOf(c) === -1) p.push(c);
		return p;
	}, []);
	return walk;
}

function edgeNeighbors(cell) {
	var walk = [cell.id().toString()];
	neighbors = cell.edgeNeighbors();
	for (const neighbor of neighbors) {
		getEdgeNeighbors(neighbor, walk, recurse);
	}
	// unique
	walk = walk.reduce(function(p, c) {
		if(p.indexOf(c) === -1) p.push(c);
		return p;
	}, []);
	return walk;
}

// var origin = new s2.S2CellId(new bignum("9926593617487462400"));
var origin = new s2.S2CellId().from_lat_lng(new s2.S2LatLng().from_degrees(lat, lng)).parent(15);
console.log(getEdgeNeighbors(origin));

var walk = [origin.id().toString()];
var neighbors = origin.edgeNeighbors();
for (const neighbor of neighbors) {
	walk.push(neighbor.id().toString());
}
console.log(walk);
