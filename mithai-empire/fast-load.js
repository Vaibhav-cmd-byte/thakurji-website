/*
 * Fast loader for the Mithai Empire web build.
 *
 * GitHub Pages does not compress the 39 MB engine file (index.wasm), so phones
 * were downloading the full size. We ship a gzip copy (index.wasm.gz, ~10 MB)
 * and unzip it in the browser with the built-in DecompressionStream.
 * If anything about that fails, it quietly falls back to the plain file.
 *
 * It also counts real network bytes so the loading screen can show
 * "x of y MB" honestly.
 */
(function () {
	'use strict';

	// Real download sizes (bytes). Update when the build changes.
	var GZ = { 'index.wasm': 10084297 };
	var PLAIN = { 'index.wasm': 39514754, 'index.pck': 6311868 };

	var canUnzip = typeof DecompressionStream === 'function' && typeof ReadableStream === 'function';
	var net = { loaded: 0, total: 0 };
	Object.keys(PLAIN).forEach(function (k) {
		net.total += (canUnzip && GZ[k]) ? GZ[k] : PLAIN[k];
	});
	window.__tjNet = net;

	var origFetch = window.fetch.bind(window);

	function nameOf(url) {
		try {
			var u = new URL(url, location.href);
			return u.pathname.slice(u.pathname.lastIndexOf('/') + 1);
		} catch (e) {
			return '';
		}
	}

	// Wrap a body stream so we count bytes as they arrive.
	function counted(body) {
		var reader = body.getReader();
		return new ReadableStream({
			pull: function (c) {
				return reader.read().then(function (r) {
					if (r.done) { c.close(); return; }
					net.loaded += r.value.length;
					c.enqueue(r.value);
				});
			},
			cancel: function (why) { return reader.cancel(why); },
		});
	}

	// Unzip only if the bytes really are gzip (magic 1f 8b); otherwise pass through.
	function maybeGunzip(stream) {
		var reader = stream.getReader();
		return reader.read().then(function (first) {
			var head = new ReadableStream({
				start: function (c) {
					if (first.done) { c.close(); } else { c.enqueue(first.value); }
				},
				pull: function (c) {
					return reader.read().then(function (r) {
						if (r.done) { c.close(); } else { c.enqueue(r.value); }
					});
				},
				cancel: function (why) { return reader.cancel(why); },
			});
			var v = first.value;
			if (v && v.length > 1 && v[0] === 0x1f && v[1] === 0x8b) {
				return head.pipeThrough(new DecompressionStream('gzip'));
			}
			return head;
		});
	}

	function typeFor(name) {
		return name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
	}

	window.fetch = function (input, init) {
		var url = typeof input === 'string' ? input : (input && input.url) || '';
		var name = nameOf(url);
		if (!PLAIN[name]) {
			return origFetch(input, init);
		}

		function plain() {
			return origFetch(input, init).then(function (res) {
				if (!res.ok || !res.body) { return res; }
				return new Response(counted(res.body), {
					status: res.status,
					headers: { 'Content-Type': typeFor(name) },
				});
			});
		}

		if (!canUnzip || !GZ[name]) {
			return plain();
		}

		return origFetch(url + '.gz', { credentials: 'same-origin' }).then(function (res) {
			if (!res.ok || !res.body) { throw new Error('gz ' + res.status); }
			return maybeGunzip(counted(res.body)).then(function (body) {
				return new Response(body, {
					status: 200,
					headers: { 'Content-Type': typeFor(name) },
				});
			});
		}).catch(function (e) {
			console.warn('Fast load fell back to plain file:', e);
			net.total += PLAIN[name] - GZ[name];
			return plain();
		});
	};
}());
