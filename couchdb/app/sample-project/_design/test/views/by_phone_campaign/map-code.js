'use strict'

module.exports.map = function (doc) {
  if (doc.docType === 'test') {
    emit(doc._id)
  }
}
