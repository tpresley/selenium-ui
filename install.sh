#!/bin/bash

if [ -e /Applications/node-webkit.app ] ; then
	echo "node-webkit already installed"
else
	echo "downloading node-webkit"
	mkdir nwtmp
	cd nwtmp
	curl https://s3.amazonaws.com/node-webkit/v0.9.2/node-webkit-v0.9.2-osx-ia32.zip -o nw.zip
	echo "unzipping node-webkit"
	unzip nw.zip
	echo "moving node-webkit into applications folder"
	mv node-webkit.app /Applications/node-webkit.app
	cd ..
	rm -rf nwtmp
	echo "node-webkit installed"
fi

if grep -e "^alias nw" ~/.bash_profile ; then
	echo "Alias already exists"
else
	echo "creating nw alias for node-webkit"
	echo "alias nw=\"/Applications/node-webkit.app/Contents/MacOS/node-webkit\"" >> ~/.bash_profile
fi

if [ ! -e /usr/bin/node ] ; then
	echo "linking node to /usr/bin dir"
	sudo ln -s /usr/local/bin/node /usr/bin/node
else
	echo "node already linked"
fi

if [ ! -e /usr/bin/mocha ] ; then
	echo "linking mocha to /usr/bin dir"
	sudo ln -s /usr/local/bin/mocha /usr/bin/mocha
else
	echo "mocha already linked"
fi

if [ ! -e /usr/bin/parallel-mocha ] ; then
	echo "linking parallel-mocha to /usr/bin dir"
	sudo ln -s /usr/local/bin/parallel-mocha /usr/bin/parallel-mocha
else
	echo "parallel-mocha already linked"
fi
