import pathUtil from 'path';
import async from 'async';
import fs from 'fs';

const simplePartials = {};
const partials = {};
const resultPartials = {};

export default function (BasePlugin) {

  return class BaseClass extends BasePlugin {

    get name () {
      return 'partials';
    }

    renderDocument (opts, next) {

      const partialContainerRegex = /\[partial:([^\]]+)\]/g;
      const partialContainers = (opts.content || '').match(partialContainerRegex) || [];

      if (!partialContainers.length) return next();
      const asyncPartials = {};
      partialContainers.forEach((container) => {
        const partialId = container.replace(partialContainerRegex, '$1');
        asyncPartials[partialId] = partials[partialId];
      });

      async.parallel(asyncPartials, () => {
        opts.content = opts.content.replace(partialContainerRegex, (match, partialId) => {
          const partial = resultPartials[partialId];
          return partial;
        });
        next();
      });

    }

    renderAfter (opts) {

      const simplePartialContainerRegex = /\[simple_partial:([^\]]+)\]/g;

      opts.collection.models.forEach((model) => {
        const simplePartialContainers = (model.get('contentRendered') || '').match(simplePartialContainerRegex) || [];

        if (simplePartialContainers.length) {
          const content = model.get('contentRendered').replace(simplePartialContainerRegex, (match, partialId) =>  simplePartials[partialId] || '');

          model.set('contentRendered', content);
        }
      });
    }

    populateCollections (opts, next) {
      const docpad = this.docpad;
      const docpadConfig = docpad.getConfig();
      const partialsPath = pathUtil.resolve(docpadConfig.srcPath, 'partials');

      docpad.parseDocumentDirectory({
        path: partialsPath
      }, next);
    }

    extendCollections () {
      const docpad = this.docpad;
      const docpadConfig = docpad.getConfig();
      const partialsPath = pathUtil.resolve(docpadConfig.srcPath, 'partials');
      const database = docpad.getDatabase();

      const dbQuery = database.createLiveChildCollection().setQuery('isPartial', {
        $or: {
          isPartial: true,
          fullPath: {
            $startsWith: partialsPath
          }
        }
      });

      const dbQueryWithHandler = dbQuery.on('add', (model) => {
        model.setDefaults({
          isPartial: true,
          render: false,
          write: false
        });
      });

      docpad.setCollection('partials', dbQueryWithHandler);
    }

    writeAfter () {
      const docpadConfig = this.docpad.getConfig();
      const partialsPath = pathUtil.resolve(docpadConfig.srcPath, 'partials');
      const path = `${partialsPath}/generated`;

      deleteFolderRecursive(path);
    }

    extendTemplateData (template) {

      const self = this;

      const docpad = this.docpad;
      const docpadConfig = docpad.getConfig();
      const partialsPath = pathUtil.resolve(docpadConfig.srcPath, 'partials');


      template.templateData.partial = function (partialName, templateData) {

        const config = self.getConfig().extensions || { extensions: ['eco'] };

        const partialFuzzyPath = pathUtil.join(partialsPath, partialName);
        const rawPartial = docpad.getCollection('partials').fuzzyFindOne(partialFuzzyPath);

        if (!rawPartial) return `Partial ${partialName} doesn't exist`;

        const partial = rawPartial.toJSON();

        if (!partial.content) return '';

        const isAnyExtensionProvided = Array.isArray(config.extensions);
        const isProperExtension = isAnyExtensionProvided && config.extensions.find((extension) => partial.extensions.includes(extension) );

        if (!isProperExtension) {
          if (simplePartials[partialName]) return `[simple_partial:${partialName}]`;
          docpad.renderDocument(rawPartial, {
            templateData: {}
          }, (err, result) => {
            if (err) docpad.log(`Rendering ${partialName} failed with error: ${err}`);
            simplePartials[partialName] =  err ? `Partial ${partialName} can't be rendered` : result.replace(/\n$/, ''); // this replace is removing LAST EOL - eco templating forces one liners to end with \n
          });

          return `[simple_partial:${partialName}]`;
        }

        const id = Math.random();
        const container = `[partial:${id}]`;
        templateData = Object.assign(templateData || {}, this);

        partials[id] = function (cb) {
          docpad.renderDocument(rawPartial, {
            templateData
          }, (err, result) => {
            resultPartials[id] = result;
            cb(err, result);
          });
        };

        return container;

      };

    }
  };

}

function deleteFolderRecursive (path) {

  if (fs.existsSync(path) ) {

    fs.readdirSync(path).forEach((file) => {
      const curPath = `${path}/${file}`;
      if (fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      }
      else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
}
