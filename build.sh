#!/bin/bash

nomangle=$( [[ "${@}" == *'--no-mangle'* ]]; echo $(( ! ${?} )) );
repodir="$( git rev-parse --show-toplevel )";
workdir="$( mktemp --dir )";

cp "${repodir}/src/metadata.json" "${workdir}/metadata.json";

for repofile in "${repodir}/src/"*.'js'
do
  [[ "${repofile}" == "${repodir}/src/banner.js" ]] && continue;

  workfile="$( sed "s/$(
    sed 's/\\/\\\\/g;s/\//\\\//g' <<< "${repodir}"
  )\/src/$(
    sed 's/\\/\\\\/g;s/\//\\\//g' <<< "${workdir}"
  )/g" <<< "${repofile}" )";

  if (( ! ${nomangle} ))
  then
    cp "${repodir}/src/banner.js" "${workfile}";

    yarn run \
      --silent \
      terser \
      "${repofile}" \
      --compress \
      --define DEBUG=false \
      --mangle reserved=['imports','init'],toplevel \
      --mangle-props regex='/^(_|CancellablePromise|Cell|DISABLED|ENABLED|Extension|Item|Queue|State)/' \
      --format max_line_len=80 \
      >> "${workfile}";
  else
    cp "${repodir}/src/banner.js" "${workfile}";

    printf "const DEBUG=true;" >> "${workfile}";
    
    cat "${repofile}" >> "${workfile}";
  fi
done

cd "${workdir}";

mv 'preferences.js' 'prefs.js';

zip "${repodir}/fig-gnome-integration@fig.io.zip" *;

cd "${repodir}";

rm -rf "${workdir}";
rm -rf /tmp/yarn--*;
