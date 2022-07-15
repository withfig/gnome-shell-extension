#!/bin/bash

repodir="${PWD}";
workdir="$(mktemp --dir)";

for file in src/*.js
do
  [[ "${file}" == 'src/banner.js' ]] && continue;

  cp 'src/banner.js' "$(sed "s/src/$(sed 's/\\/\\\\/g;s/\//\\\//g' <<< "${workdir}")/g" <<< "${file}")";

  yarn run \
    --silent \
    terser \
    "${file}" \
    --compress \
    --mangle reserved=['imports'] \
    --format max_line_len=80 \
    >> "$(sed "s/src/$(sed 's/\\/\\\\/g;s/\//\\\//g' <<< "${workdir}")/g" <<< "${file}")";
done

cd "${workdir}";

mv 'preferences.js' 'prefs.js';

zip "${repodir}/fig-gnome-integration@fig.io.zip" *;

cd "${repodir}";

rm -rf "${workdir}";
rm -rf /tmp/yarn--*;
